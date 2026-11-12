import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { banSchema, can, canCreateChannel, canManageChannel, canModerate, channelMuteSchema, createChannelSchema, updateChannelSchema } from '@zirzircord/shared';
import type { VoiceTokenResponse } from '@zirzircord/shared';
import { env } from '../env';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { toChannelDTO, toPublicUser } from '../lib/serializers';
import { deleteKeys } from '../lib/storage';
import { requireChannelAccess, requireMember } from '../sessions/access';
import { rooms } from '../sessions/hub';
import { createVoiceToken, deleteRoom, kickFromRoom, roomName } from '../voice/livekit';
import { applyServerMute } from '../sessions/routes';
import { syncRoomSoon } from '../voice/sync';

const cid = z.object({ id: z.string().uuid() });
const cidUid = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

export async function channelRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  async function loadForModeration(channelId: string, actorId: string, action: 'channel.kick' | 'channel.ban' | 'voice.serverMute') {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) throw notFound('Channel');
    const actor = await requireMember(channel.sessionId, actorId);
    if (!can(actor.role, action)) throw forbidden();
    return { channel, actor };
  }

  async function assertCanModerateUser(sessionId: string, actorRole: any, userId: string) {
    const target = await prisma.sessionMember.findUnique({ where: { sessionId_userId: { sessionId, userId } } });
    if (!target) throw badRequest('That user is not a member of this session', 'not_member');
    if (!canModerate(actorRole, target.role)) throw forbidden('You cannot moderate this member');
  }

  app.post('/sessions/:id/channels', auth, async (req) => {
    const { id } = cid.parse(req.params);
    const body = createChannelSchema.parse(req.body);
    const m = await requireMember(id, req.auth.userId);
    if (!canCreateChannel(m.role, body.type, m.session)) {
      throw forbidden(`Creating ${body.type === 'TEXT' ? 'text' : 'voice'} channels is disabled in this session`, 'channel_creation_disabled');
    }
    const last = await prisma.channel.findFirst({ where: { sessionId: id }, orderBy: { position: 'desc' } });
    const channel = await prisma.channel.create({
      data: {
        sessionId: id,
        type: body.type,
        name: body.type === 'TEXT' ? body.name.toLowerCase().replace(/\s+/g, '-') : body.name,
        position: (last?.position ?? 0) + 1,
        createdById: req.auth.userId,
        audioPreset: body.audioPreset ?? 'HIGH',
        userLimit: body.userLimit ?? 0,
      },
    });
    app.io.in(rooms.session(id)).socketsJoin(rooms.channel(channel.id));
    app.io.to(rooms.session(id)).emit('channel:upsert', toChannelDTO(channel));
    return { channel: toChannelDTO(channel) };
  });

  app.patch('/channels/:id', auth, async (req) => {
    const { id } = cid.parse(req.params);
    const body = updateChannelSchema.parse(req.body);
    const { channel, member } = await requireChannelAccess(id, req.auth.userId);
    if (!canManageChannel(member.role, req.auth.userId, channel.createdById)) throw forbidden();
    const updated = await prisma.channel.update({
      where: { id },
      data: {
        ...body,
        name: body.name && channel.type === 'TEXT' ? body.name.toLowerCase().replace(/\s+/g, '-') : body.name,
      },
    });
    // Channel bans hide the channel, so only emit to sockets that can see it.
    app.io.to(rooms.channel(id)).emit('channel:upsert', toChannelDTO(updated));
    return { channel: toChannelDTO(updated) };
  });

  app.delete('/channels/:id', auth, async (req) => {
    const { id } = cid.parse(req.params);
    const { channel, member } = await requireChannelAccess(id, req.auth.userId);
    if (!canManageChannel(member.role, req.auth.userId, channel.createdById)) throw forbidden();
    const attachments = await prisma.attachment.findMany({
      where: { message: { channelId: id } },
      select: { storageKey: true, thumbnailKey: true },
    });
    await prisma.channel.delete({ where: { id } });
    if (channel.type === 'VOICE') {
      await deleteRoom(roomName(channel.sessionId, id));
      await app.hub.clearVoiceChannel(channel.sessionId, id);
    }
    await deleteKeys(attachments.flatMap((a) => [a.storageKey, a.thumbnailKey].filter(Boolean) as string[])).catch(() => {});
    app.io.to(rooms.session(channel.sessionId)).emit('channel:deleted', { sessionId: channel.sessionId, channelId: id });
    app.io.in(rooms.channel(id)).socketsLeave(rooms.channel(id));
    return { ok: true };
  });

  // ------------------------------------------------------------------ voice

  app.post('/channels/:id/voice-token', auth, async (req): Promise<VoiceTokenResponse> => {
    const { id } = cid.parse(req.params);
    const { channel, session } = await requireChannelAccess(id, req.auth.userId);
    if (channel.type !== 'VOICE') throw badRequest('Not a voice channel');
    if (session.state !== 'ACTIVE' || !(await app.hub.isPresent(session.id, req.auth.userId))) {
      throw forbidden('Enter the session before joining voice', 'not_present');
    }
    if (channel.userLimit > 0) {
      const inRoom = (await app.hub.getVoiceState([id]))[id] ?? [];
      if (inRoom.length >= channel.userLimit && !inRoom.includes(req.auth.userId)) throw forbidden('This voice channel is full', 'channel_full');
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    const member = await prisma.sessionMember.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
    });
    const room = roomName(session.id, id);
    const pub = toPublicUser(user);
    const token = await createVoiceToken({
      room,
      userId: user.id,
      name: member.nickname || user.displayName,
      metadata: { publicId: pub.publicId, avatarUrl: pub.avatarUrl },
      micAllowed: !member.serverMuted,
    });
    syncRoomSoon(app.hub, session.id, id);
    return { url: env.LIVEKIT_URL, token, room, audioPreset: channel.audioPreset };
  });

  /** Legacy alias: server-mute from a voice channel = session-wide server mute. */
  app.post('/channels/:id/mute/:userId', auth, async (req) => {
    const { id, userId } = cidUid.parse(req.params);
    const { channel, actor } = await loadForModeration(id, req.auth.userId, 'voice.serverMute');
    await assertCanModerateUser(channel.sessionId, actor.role, userId);
    await applyServerMute(app, channel.sessionId, userId, true);
    return { ok: true };
  });

  /** Mute notifications from one channel for yourself (until a time, or indefinitely). */
  app.put('/channels/:id/mute', auth, async (req) => {
    const { id } = cid.parse(req.params);
    const { mutedUntil } = channelMuteSchema.parse(req.body);
    await requireChannelAccess(id, req.auth.userId);
    const until = mutedUntil ? new Date(mutedUntil) : null;
    await prisma.channelMute.upsert({
      where: { channelId_userId: { channelId: id, userId: req.auth.userId } },
      create: { channelId: id, userId: req.auth.userId, mutedUntil: until },
      update: { mutedUntil: until },
    });
    return { ok: true };
  });

  app.delete('/channels/:id/mute', auth, async (req) => {
    const { id } = cid.parse(req.params);
    await prisma.channelMute.deleteMany({ where: { channelId: id, userId: req.auth.userId } });
    return { ok: true };
  });

  app.post('/channels/:id/kick/:userId', auth, async (req) => {
    const { id, userId } = cidUid.parse(req.params);
    const { channel, actor } = await loadForModeration(id, req.auth.userId, 'channel.kick');
    await assertCanModerateUser(channel.sessionId, actor.role, userId);
    if (channel.type === 'VOICE') await kickFromRoom(roomName(channel.sessionId, id), userId);
    app.io.to(rooms.user(userId)).emit('channel:removed', { sessionId: channel.sessionId, channelId: id, reason: 'kicked' });
    return { ok: true };
  });

  // ---------------------------------------------------------------- bans

  app.get('/channels/:id/bans', auth, async (req) => {
    const { id } = cid.parse(req.params);
    await loadForModeration(id, req.auth.userId, 'channel.ban');
    const bans = await prisma.channelBan.findMany({ where: { channelId: id }, orderBy: { createdAt: 'desc' } });
    const users = await prisma.user.findMany({ where: { id: { in: bans.map((b) => b.userId) } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      bans: bans
        .filter((b) => byId.has(b.userId))
        .map((b) => ({ user: toPublicUser(byId.get(b.userId)!), reason: b.reason, bannedById: b.bannedById, createdAt: b.createdAt.toISOString() })),
    };
  });

  app.post('/channels/:id/bans/:userId', auth, async (req) => {
    const { id, userId } = cidUid.parse(req.params);
    const body = banSchema.parse(req.body ?? {});
    const { channel, actor } = await loadForModeration(id, req.auth.userId, 'channel.ban');
    await assertCanModerateUser(channel.sessionId, actor.role, userId);
    await prisma.channelBan.upsert({
      where: { channelId_userId: { channelId: id, userId } },
      create: { channelId: id, userId, reason: body.reason, bannedById: req.auth.userId },
      update: { reason: body.reason, bannedById: req.auth.userId },
    });
    if (channel.type === 'VOICE') await kickFromRoom(roomName(channel.sessionId, id), userId);
    app.io.in(rooms.user(userId)).socketsLeave(rooms.channel(id));
    app.io.to(rooms.user(userId)).emit('channel:removed', { sessionId: channel.sessionId, channelId: id, reason: 'banned' });
    return { ok: true };
  });

  app.delete('/channels/:id/bans/:userId', auth, async (req) => {
    const { id, userId } = cidUid.parse(req.params);
    const { channel } = await loadForModeration(id, req.auth.userId, 'channel.ban');
    await prisma.channelBan.deleteMany({ where: { channelId: id, userId } });
    // Give the channel back to the user's sockets that are inside the session.
    const sockets = await app.io.in(rooms.user(userId)).fetchSockets();
    for (const s of sockets) if (s.rooms.has(rooms.session(channel.sessionId))) s.join(rooms.channel(id));
    app.io.to(rooms.user(userId)).emit('channel:upsert', toChannelDTO(channel));
    return { ok: true };
  });
}
