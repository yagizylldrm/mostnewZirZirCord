import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { LIMITS, MAX_REACTIONS_PER_MESSAGE, can, canMentionEveryone, editMessageSchema, neutralizeEveryone, parseMentions, reactionEmojiSchema, sendMessageSchema } from '@zirzircord/shared';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { toMessageDTO, toReactionDTOs } from '../lib/serializers';
import { assertNotTimedOut, hitMessageLimit, hitReactionLimit } from '../lib/spam';
import { randomUUID } from 'node:crypto';
import { copyObject, deleteKeys, getObjectBuffer, headObject, putObject } from '../lib/storage';
import { requireChannelAccess } from '../sessions/access';
import { rooms } from '../sessions/hub';

const cid = z.object({ id: z.string().uuid() });
const include = { attachments: true, reactions: true } as const;
const ACTIVITY_BUMP_MS = 60 * 60 * 1000;
const THUMBNAIL_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Resolves mention tokens: keeps only real session members, and honours
 * @everyone only for people allowed to use it (otherwise it's neutralised).
 */
async function resolveMentions(content: string, sessionId: string, role: Parameters<typeof canMentionEveryone>[0], session: { membersCanMentionEveryone: boolean }) {
  const { userIds, everyone } = parseMentions(content);
  const members = userIds.length
    ? await prisma.sessionMember.findMany({ where: { sessionId, userId: { in: userIds } }, select: { userId: true } })
    : [];
  const allowedEveryone = everyone && canMentionEveryone(role, session);
  return {
    content: everyone && !allowedEveryone ? neutralizeEveryone(content) : content,
    mentions: members.map((m) => m.userId),
    mentionsEveryone: allowedEveryone,
  };
}

/** Checks that uploaded attachments belong to this user/session and finished uploading. */
async function validateUploads(ids: string[], userId: string, sessionId: string) {
  if (!ids.length) return [];
  const rows = await prisma.attachment.findMany({ where: { id: { in: ids } } });
  if (rows.length !== ids.length) throw badRequest('Unknown attachment');
  await Promise.all(
    rows.map(async (a) => {
      if (a.uploaderId !== userId || a.sessionId !== sessionId || a.messageId) throw badRequest('Invalid attachment');
      const head = await headObject(a.storageKey);
      if (!head) throw badRequest(`Upload of ${a.filename} did not finish`, 'upload_missing');
      if (head.size !== a.size) throw badRequest(`Upload of ${a.filename} is incomplete`, 'upload_size');
    }),
  );
  return rows;
}

/** Copies a sticker from the sender's collection into the session (so it's deleted with the session). */
async function copyStickerIntoSession(stickerId: string, userId: string, sessionId: string) {
  const st = await prisma.sticker.findUnique({ where: { id: stickerId } });
  if (!st || st.ownerId !== userId) throw badRequest('Unknown sticker');
  const attId = randomUUID();
  const key = `sessions/${sessionId}/${attId}/sticker.webp`;
  const stillKey = st.animated ? `${key}.still.webp` : null;
  const [size] = await Promise.all([
    copyObject(st.storageKey, key),
    stillKey ? copyObject(`${st.storageKey}.still.webp`, stillKey).catch(() => 0) : Promise.resolve(0),
  ]);
  return prisma.attachment.create({
    data: {
      id: attId,
      sessionId,
      uploaderId: userId,
      kind: 'STICKER',
      filename: 'sticker.webp',
      mime: 'image/webp',
      size,
      storageKey: key,
      thumbnailKey: stillKey,
      width: st.width,
      height: st.height,
    },
  });
}

export async function messageRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get('/channels/:id/messages', auth, async (req) => {
    const { id } = cid.parse(req.params);
    const q = z
      .object({ before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(LIMITS.messagePageSize) })
      .parse(req.query);
    const { channel } = await requireChannelAccess(id, req.auth.userId);
    if (channel.type !== 'TEXT') throw badRequest('Not a text channel');
    // One query: cursor lookup + messages + their attachments (relation join).
    const rows = await prisma.message.findMany({
      relationLoadStrategy: 'join',
      where: { channelId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
      include,
    });
    return { messages: await Promise.all(rows.reverse().map(toMessageDTO)), hasMore: rows.length === q.limit };
  });

  app.post('/channels/:id/messages', { ...auth, config: { rateLimit: { max: 30, timeWindow: '10 seconds' } } }, async (req) => {
    const { id } = cid.parse(req.params);
    const body = sendMessageSchema.parse(req.body);
    const { channel, session, member } = await requireChannelAccess(id, req.auth.userId);
    if (channel.type !== 'TEXT') throw badRequest('Not a text channel');
    if (session.state !== 'ACTIVE') throw forbidden('Session is not active');
    assertNotTimedOut(member);
    await hitMessageLimit(app.io, session.id, req.auth.userId);

    // Everything below is independent, so run it in parallel (each step is a
    // network round trip to the database or storage).
    const [uploads, stickerAtt, resolved] = await Promise.all([
      validateUploads(body.attachmentIds, req.auth.userId, session.id),
      body.stickerId ? copyStickerIntoSession(body.stickerId, req.auth.userId, session.id) : Promise.resolve(null),
      resolveMentions(body.content, session.id, member.role, session),
      body.replyToId
        ? prisma.message.findUnique({ where: { id: body.replyToId }, select: { channelId: true } }).then((r) => {
            if (r?.channelId !== id) throw badRequest('Invalid reply');
          })
        : Promise.resolve(),
    ]);
    const attachments = stickerAtt ? [...uploads, stickerAtt] : uploads;

    // A plain INSERT … RETURNING (no nested writes → no transaction, one round trip).
    const msg = await prisma.message.create({
      data: {
        channelId: id,
        authorId: req.auth.userId,
        content: resolved.content,
        mentions: resolved.mentions,
        mentionsEveryone: resolved.mentionsEveryone,
        replyToId: body.replyToId,
      },
    });
    if (attachments.length) {
      const claimed = await prisma.attachment.updateMany({
        where: { id: { in: attachments.map((a) => a.id) }, messageId: null },
        data: { messageId: msg.id },
      });
      if (claimed.count !== attachments.length) {
        await prisma.message.delete({ where: { id: msg.id } }).catch(() => {});
        throw badRequest('Invalid attachment');
      }
      attachments.forEach((a) => (a.messageId = msg.id));
    }
    const dto = { ...(await toMessageDTO({ ...msg, attachments })), nonce: body.nonce };
    app.io.to(rooms.channel(id)).emit('message:new', dto);
    // Keeps set sessions awake (at most one write per hour per session).
    void prisma.session
      .updateMany({ where: { id: session.id, lastActiveAt: { lt: new Date(Date.now() - ACTIVITY_BUMP_MS) } }, data: { lastActiveAt: new Date() } })
      .catch(() => {});

    // Generate thumbnails in the background, then push the updated message.
    // Thumbnails are made in memory, so skip very large images (they're shown as-is).
    const images = attachments.filter((a) => a.kind === 'IMAGE' && a.size <= THUMBNAIL_MAX_BYTES && /^image\/(png|jpe?g|webp|gif|avif)$/.test(a.mime));
    if (images.length) {
      void (async () => {
        for (const a of images) {
          try {
            const buf = await getObjectBuffer(a.storageKey);
            const img = sharp(buf, { animated: false, limitInputPixels: 80_000_000, sequentialRead: true });
            const meta = await img.metadata();
            const thumb = await img.rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
            const thumbnailKey = `${a.storageKey}.thumb.webp`;
            await putObject(thumbnailKey, thumb, 'image/webp');
            await prisma.attachment.update({
              where: { id: a.id },
              data: { thumbnailKey, width: a.width ?? meta.width, height: a.height ?? meta.height },
            });
          } catch (err) {
            req.log.warn({ err }, 'thumbnail failed');
          }
        }
        const fresh = await prisma.message.findUnique({ where: { id: msg.id }, include });
        if (fresh) app.io.to(rooms.channel(id)).emit('message:updated', await toMessageDTO(fresh));
      })();
    }
    return { message: dto };
  });

  app.patch('/messages/:id', auth, async (req) => {
    const { id } = cid.parse(req.params);
    const body = editMessageSchema.parse(req.body);
    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg) throw notFound('Message');
    const { session, member } = await requireChannelAccess(msg.channelId, req.auth.userId);
    if (msg.authorId !== req.auth.userId) throw forbidden('You can only edit your own messages');
    assertNotTimedOut(member);
    const resolved = await resolveMentions(body.content, session.id, member.role, session);
    const updated = await prisma.message.update({
      where: { id },
      data: { content: resolved.content, mentions: resolved.mentions, mentionsEveryone: resolved.mentionsEveryone, editedAt: new Date() },
      include,
    });
    const dto = await toMessageDTO(updated);
    app.io.to(rooms.channel(msg.channelId)).emit('message:updated', dto);
    return { message: dto };
  });

  app.delete('/messages/:id', auth, async (req) => {
    const { id } = cid.parse(req.params);
    const msg = await prisma.message.findUnique({ where: { id }, include });
    if (!msg) throw notFound('Message');
    const { member } = await requireChannelAccess(msg.channelId, req.auth.userId);
    if (msg.authorId !== req.auth.userId && !can(member.role, 'message.deleteAny')) throw forbidden();
    await prisma.message.delete({ where: { id } });
    await deleteKeys(msg.attachments.flatMap((a) => [a.storageKey, a.thumbnailKey].filter(Boolean) as string[])).catch(() => {});
    app.io.to(rooms.channel(msg.channelId)).emit('message:deleted', { channelId: msg.channelId, messageId: id });
    return { ok: true };
  });

  // -------------------------------------------------------------- reactions

  const reactParams = z.object({ id: z.string().uuid(), emoji: z.string() });

  async function reactionTarget(params: unknown, userId: string) {
    const { id, emoji: raw } = reactParams.parse(params);
    const emoji = reactionEmojiSchema.parse(raw); // Fastify already percent-decodes params
    const msg = await prisma.message.findUnique({ where: { id }, select: { id: true, channelId: true } });
    if (!msg) throw notFound('Message');
    const { member } = await requireChannelAccess(msg.channelId, userId);
    assertNotTimedOut(member);
    await hitReactionLimit(userId);
    return { msg, emoji };
  }

  async function broadcastReactions(messageId: string, channelId: string) {
    const rows = await prisma.reaction.findMany({ where: { messageId } });
    const reactions = toReactionDTOs(rows);
    app.io.to(rooms.channel(channelId)).emit('reaction:update', { channelId, messageId, reactions });
    return reactions;
  }

  app.put('/messages/:id/reactions/:emoji', auth, async (req) => {
    const { msg, emoji } = await reactionTarget(req.params, req.auth.userId);
    const existing = await prisma.reaction.findMany({ where: { messageId: msg.id }, select: { emoji: true }, distinct: ['emoji'] });
    if (!existing.some((r) => r.emoji === emoji) && existing.length >= MAX_REACTIONS_PER_MESSAGE) {
      throw badRequest(`A message can have at most ${MAX_REACTIONS_PER_MESSAGE} different reactions`, 'too_many_reactions');
    }
    await prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId: msg.id, userId: req.auth.userId, emoji } },
      create: { messageId: msg.id, userId: req.auth.userId, emoji },
      update: {},
    });
    return { reactions: await broadcastReactions(msg.id, msg.channelId) };
  });

  app.delete('/messages/:id/reactions/:emoji', auth, async (req) => {
    const { msg, emoji } = await reactionTarget(req.params, req.auth.userId);
    await prisma.reaction.deleteMany({ where: { messageId: msg.id, userId: req.auth.userId, emoji } });
    return { reactions: await broadcastReactions(msg.id, msg.channelId) };
  });
}
