import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mediaUploadSchema, updateProfileSchema } from '@zirzircord/shared';
import { prisma } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { processImage, type MediaKind } from '../lib/media';
import { toPublicUser, toSelfUser } from '../lib/serializers';
import { deleteKeys, getObjectBuffer, headObject, presignGet, presignPut, putObject } from '../lib/storage';
import { rooms } from '../sessions/hub';

const PREFIX: Record<MediaKind, string> = { avatar: 'avatars', banner: 'banners', sticker: 'sticker-uploads' };

/**
 * Turns a finished profile-media upload (pending attachment) into processed
 * files. Returns the final + still keys and deletes the raw upload.
 */
export async function consumeMediaUpload(userId: string, uploadId: string, kind: MediaKind) {
  const att = await prisma.attachment.findUnique({ where: { id: uploadId } });
  if (!att || att.uploaderId !== userId || att.sessionId !== null || !att.storageKey.startsWith(`${PREFIX[kind]}/${userId}/`)) {
    throw badRequest(`Invalid ${kind} upload`);
  }
  const head = await headObject(att.storageKey);
  if (!head) throw badRequest('Upload did not finish', 'upload_missing');
  let processed;
  try {
    processed = await processImage(await getObjectBuffer(att.storageKey), kind);
  } catch {
    throw badRequest('That file is not a supported image', 'bad_image');
  } finally {
    await prisma.attachment.delete({ where: { id: att.id } }).catch(() => {});
    await deleteKeys([att.storageKey]).catch(() => {});
  }
  return { ...processed, baseKey: `${PREFIX[kind]}/${userId}/${randomUUID()}` };
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    return { user: toSelfUser(user) };
  });

  app.patch('/me', { preHandler: app.authenticate }, async (req) => {
    const body = updateProfileSchema.parse(req.body);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    const data: Record<string, unknown> = {
      displayName: body.displayName,
      bio: body.bio,
      bannerColor: body.bannerColor,
      status: body.status,
    };
    const obsolete: (string | null)[] = [];

    for (const kind of ['avatar', 'banner'] as const) {
      const uploadId = kind === 'avatar' ? body.avatarUploadId : body.bannerUploadId;
      if (uploadId === undefined) continue;
      const keyField = kind === 'avatar' ? 'avatarKey' : 'bannerKey';
      const stillField = kind === 'avatar' ? 'avatarStaticKey' : 'bannerStaticKey';
      obsolete.push(current[keyField], current[stillField]);
      if (uploadId === null) {
        data[keyField] = null;
        data[stillField] = null;
        continue;
      }
      const img = await consumeMediaUpload(current.id, uploadId, kind);
      const mainKey = `${img.baseKey}.webp`;
      await putObject(mainKey, img.main, 'image/webp');
      data[keyField] = mainKey;
      if (img.still) {
        const stillKey = `${img.baseKey}.still.webp`;
        await putObject(stillKey, img.still, 'image/webp');
        data[stillField] = stillKey;
      } else data[stillField] = null;
    }

    const user = await prisma.user.update({ where: { id: current.id }, data });
    const keep = new Set([user.avatarKey, user.avatarStaticKey, user.bannerKey, user.bannerStaticKey]);
    const toDelete = obsolete.filter((k): k is string => !!k && !keep.has(k));
    if (toDelete.length) await deleteKeys(toDelete).catch(() => {});

    // Let every session this user belongs to see the new profile.
    const memberships = await prisma.sessionMember.findMany({ where: { userId: user.id }, select: { sessionId: true } });
    const pub = toPublicUser(user);
    if (memberships.length) app.io.to(memberships.map((m) => rooms.session(m.sessionId))).emit('user:updated', pub);
    return { user: toSelfUser(user) };
  });

  /** Step 1 of an avatar / banner / sticker upload: presigned PUT for the raw image. */
  app.post('/me/media-upload', { preHandler: app.authenticate }, async (req) => {
    const body = mediaUploadSchema.parse(req.body);
    const id = randomUUID();
    const key = `${PREFIX[body.purpose]}/${req.auth.userId}/upload-${id}`;
    await prisma.attachment.create({
      data: { id, uploaderId: req.auth.userId, kind: 'IMAGE', filename: body.purpose, mime: body.mime, size: body.size, storageKey: key },
    });
    return { attachmentId: id, uploadUrl: await presignPut(key, body.mime, body.size), headers: { 'Content-Type': body.mime } };
  });

  /** Stable avatar / banner URLs usable directly in <img>. `?static=1` = first frame. */
  for (const kind of ['avatar', 'banner'] as const) {
    app.get(`/users/:id/${kind}`, async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const still = (req.query as Record<string, string>).static === '1';
      const user = await prisma.user.findUnique({ where: { id }, select: { avatarKey: true, avatarStaticKey: true, bannerKey: true, bannerStaticKey: true } });
      const key = kind === 'avatar' ? (still && user?.avatarStaticKey) || user?.avatarKey : (still && user?.bannerStaticKey) || user?.bannerKey;
      if (!key) throw notFound(kind === 'avatar' ? 'Avatar' : 'Banner');
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.redirect(await presignGet(key));
    });
  }

  /** Look someone up by their public id (e.g. to appoint a moderator or ban). */
  app.get('/users/by-public-id/:publicId', { preHandler: app.authenticate }, async (req) => {
    const { publicId } = z.object({ publicId: z.string() }).parse(req.params);
    const user = await prisma.user.findUnique({ where: { publicId: publicId.toUpperCase().trim() } });
    if (!user) throw notFound('User');
    return { user: toPublicUser(user) };
  });
}
