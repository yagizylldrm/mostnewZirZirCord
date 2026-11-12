import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUploadSchema } from '@zirzircord/shared';
import type { UploadTicket } from '@zirzircord/shared';
import { env } from '../env';
import { prisma } from '../lib/db';
import { badRequest, forbidden } from '../lib/errors';
import { deleteKeys, presignPut, safeMime } from '../lib/storage';
import { requireMember } from '../sessions/access';

const sid = z.object({ id: z.string().uuid() });

function safeName(name: string) {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120);
  return cleaned || 'file';
}

export async function uploadRoutes(app: FastifyInstance) {
  /**
   * Step 1 of an upload: reserve an attachment and get a presigned PUT URL.
   * Step 2: client PUTs the bytes directly to storage.
   * Step 3: client sends a message with the attachment id.
   */
  app.post('/sessions/:id/uploads', { preHandler: app.authenticate }, async (req): Promise<UploadTicket> => {
    const { id } = sid.parse(req.params);
    const body = createUploadSchema.parse(req.body);
    const m = await requireMember(id, req.auth.userId);
    const pending = await prisma.attachment.aggregate({
      where: { uploaderId: req.auth.userId, messageId: null },
      _count: true,
      _sum: { size: true },
    });
    if (pending._count >= 30 || (pending._sum.size ?? 0) > 500 * 1024 * 1024) throw badRequest('Too many pending uploads', 'too_many_uploads');
    if (m.session.state !== 'ACTIVE') throw forbidden('Session is not active');
    if (body.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`Files can be at most ${env.MAX_UPLOAD_MB} MB`, 'too_large');
    const mime = safeMime(body.mime);
    const attachmentId = randomUUID();
    const key = `sessions/${id}/${attachmentId}/${safeName(body.filename)}`;
    await prisma.attachment.create({
      data: {
        id: attachmentId,
        sessionId: id,
        uploaderId: req.auth.userId,
        kind: body.kind,
        filename: body.filename.slice(0, 200),
        mime,
        size: body.size,
        storageKey: key,
        width: body.width,
        height: body.height,
        durationMs: body.durationMs,
        waveform: body.waveform ?? [],
      },
    });
    return { attachmentId, uploadUrl: await presignPut(key, mime, body.size), headers: { 'Content-Type': mime } };
  });
}

/** Removes uploads that were never attached to a message (abandoned after 24h). */
export async function cleanupPendingUploads() {
  const stale = await prisma.attachment.findMany({
    where: { messageId: null, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    take: 500,
  });
  if (!stale.length) return;
  await deleteKeys(stale.map((a) => a.storageKey)).catch(() => {});
  await prisma.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
}
