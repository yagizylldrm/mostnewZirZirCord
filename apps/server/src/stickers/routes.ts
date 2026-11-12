import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_STICKERS_PER_USER, PROFILE_IMAGE_MAX_BYTES, createStickerSchema, stickerFromAttachmentSchema } from '@zirzircord/shared';
import { prisma } from '../lib/db';
import { badRequest, conflict, notFound } from '../lib/errors';
import { processImage } from '../lib/media';
import { toStickerDTO } from '../lib/serializers';
import { deleteKeys, getObjectBuffer, putObject } from '../lib/storage';
import { requireChannelAccess, requireMember } from '../sessions/access';
import { consumeMediaUpload } from '../users/routes';

/** Saves processed sticker bytes into the user's collection. */
async function storeSticker(ownerId: string, img: { main: Buffer; still: Buffer | null; animated: boolean; width: number; height: number }) {
  const count = await prisma.sticker.count({ where: { ownerId } });
  if (count >= MAX_STICKERS_PER_USER) throw conflict(`You can keep up to ${MAX_STICKERS_PER_USER} stickers. Delete some first.`, 'sticker_limit');
  const sticker = await prisma.sticker.create({
    data: { ownerId, storageKey: `stickers/${ownerId}/${randomUUID()}.webp`, width: img.width, height: img.height, animated: img.animated },
  });
  await putObject(sticker.storageKey, img.main, 'image/webp');
  if (img.still) await putObject(`${sticker.storageKey}.still.webp`, img.still, 'image/webp');
  return sticker;
}

export async function stickerRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get('/me/stickers', auth, async (req) => {
    const list = await prisma.sticker.findMany({ where: { ownerId: req.auth.userId }, orderBy: { createdAt: 'desc' } });
    return { stickers: await Promise.all(list.map(toStickerDTO)) };
  });

  /** Create a sticker from an uploaded image or GIF (POST /me/media-upload with purpose=sticker first). */
  app.post('/me/stickers', auth, async (req) => {
    const { uploadId } = createStickerSchema.parse(req.body);
    const img = await consumeMediaUpload(req.auth.userId, uploadId, 'sticker');
    return { sticker: await toStickerDTO(await storeSticker(req.auth.userId, img)) };
  });

  app.delete('/me/stickers/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const st = await prisma.sticker.findUnique({ where: { id } });
    if (!st || st.ownerId !== req.auth.userId) throw notFound('Sticker');
    await prisma.sticker.delete({ where: { id } });
    await deleteKeys([st.storageKey, `${st.storageKey}.still.webp`]).catch(() => {});
    return { ok: true };
  });

  /** "Save sticker": copy a sticker someone sent into your own collection. */
  app.post('/me/stickers/from-attachment', auth, async (req) => {
    const { attachmentId } = stickerFromAttachmentSchema.parse(req.body);
    const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!att?.sessionId || !att.messageId) throw notFound('Sticker');
    const msg = await prisma.message.findUnique({ where: { id: att.messageId }, select: { channelId: true } });
    if (!msg) throw notFound('Sticker');
    // Respects channel bans, not just session membership.
    await requireChannelAccess(msg.channelId, req.auth.userId);
    if (att.kind !== 'STICKER' && att.kind !== 'IMAGE') throw badRequest('Only stickers and images can be saved as stickers');
    // Never pull big files into memory (message images may be up to MAX_UPLOAD_MB).
    if (att.size > PROFILE_IMAGE_MAX_BYTES) throw badRequest('That image is too large to become a sticker', 'too_large');
    // Re-process so images become proper stickers and size limits always hold.
    const img = await processImage(await getObjectBuffer(att.storageKey), 'sticker');
    return { sticker: await toStickerDTO(await storeSticker(req.auth.userId, img)) };
  });
}
