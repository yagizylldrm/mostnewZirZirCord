import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  banSchema,
  byPublicIdSchema,
  can,
  canModerate,
  createSessionSchema,
  generateSessionCode,
  joinSessionSchema,
  normalizeSessionCode,
  notifySettingsSchema,
  serverMuteSchema,
  updateMemberSchema,
  updateSessionSchema,
} from '@zirzircord/shared';
import type { BanDTO, SetSessionListItem } from '@zirzircord/shared';
import { prisma } from '../lib/db';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { toMemberDTO, toPublicUser, toSessionDTO } from '../lib/serializers';
import { kickFromSessionVoice, roomName, setMicAllowed } from '../voice/livekit';
import type { FastifyInstance as App } from 'fastify';
import { isSessionBanned, requireMember } from './access';
import { rooms } from './hub';

const sid = z.object({ id: z.string().uuid() });

/**
 * Server mute is session-wide and sticky: the member loses the right to publish a
 * microphone in every voice room of the session, and new voice tokens omit it.
 */
export async function applyServerMute(app: App, sessionId: string, userId: string, muted: boolean) {
  const m = await prisma.sessionMember.update({
    where: { sessionId_userId: { sessionId, userId } },
    data: { serverMuted: muted },
    include: { user: true },
  });
  const voice = await prisma.channel.findMany({ where: { sessionId, type: 'VOICE' }, select: { id: true } });
  await Promise.all(voice.map((c) => setMicAllowed(roomName(sessionId, c.id), userId, !muted)));
  app.io.to(rooms.session(sessionId)).emit('member:upsert', { sessionId, member: toMemberDTO(m) });
}
const sidUid = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateSessionCode();
    if (!(await prisma.session.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new Error('Could not allocate a session code');
}

export async function sessionRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };
  const hub = () => app.hub;

  /** Requires a role permission; returns the actor's membership. */
  async function requirePermission(sessionId: string, userId: string, action: Parameters<typeof can>[1]) {
    const m = await requireMember(sessionId, userId);
    if (!can(m.role, action)) throw forbidden();
    return m;
  }

  async function emitMember(sessionId: string, userId: string) {
    const m = await prisma.sessionMember.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
      include: { user: true },
    });
    if (m) app.io.to(rooms.session(sessionId)).emit('member:upsert', { sessionId, member: toMemberDTO(m) });
  }

  // ------------------------------------------------------------- create/join

  app.post('/sessions', { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    const body = createSessionSchema.parse(req.body);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    if (body.isSet && me.isGuest) throw forbidden('Create an account to make set sessions', 'account_required');
    const session = await prisma.session.create({
      data: {
        name: body.name,
        code: await uniqueCode(),
        ownerId: me.id,
        isSet: !!body.isSet,
        members: { create: { userId: me.id, role: 'OWNER' } },
        channels: {
          create: [
            { type: 'TEXT', name: 'general', position: 0, createdById: me.id },
            { type: 'VOICE', name: 'General', position: 1, createdById: me.id },
          ],
        },
      },
    });
    hub().scheduleEmptyCheck(session.id);
    return { session: toSessionDTO(session) };
  });

  app.post('/sessions/join', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { code: raw } = joinSessionSchema.parse(req.body);
    const code = normalizeSessionCode(raw);
    if (!code) throw badRequest('That is not a valid session code', 'invalid_code');
    const session = await prisma.session.findUnique({ where: { code } });
    if (!session) throw notFound('Session');
    const { userId, deviceHash } = req.auth;
    if (await isSessionBanned(session.id, userId, deviceHash)) throw forbidden('You are banned from this session', 'banned');
    if (session.accountsOnly) {
      const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (me.isGuest) throw forbidden('This session only allows registered accounts', 'account_required');
    }
    await prisma.sessionMember.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId } },
      create: { sessionId: session.id, userId },
      update: {},
    });
    if (!(await hub().getPresence(session.id)).present.length) hub().scheduleEmptyCheck(session.id);
    return { session: toSessionDTO(session) };
  });

  /** Sessions shown in the sidebar: set sessions you visited + temporary sessions you're in. */
  app.get('/me/sessions', auth, async (req) => {
    const memberships = await prisma.sessionMember.findMany({
      where: { userId: req.auth.userId },
      include: { session: true },
      orderBy: { lastVisitedAt: 'desc' },
    });
    const items: SetSessionListItem[] = [];
    for (const m of memberships) {
      if (!m.session.isSet && m.session.state !== 'ACTIVE') continue;
      if (await isSessionBanned(m.sessionId, req.auth.userId, req.auth.deviceHash)) continue;
      const presence = await hub().getPresence(m.sessionId);
      items.push({
        session: toSessionDTO(m.session),
        live: m.session.state === 'ACTIVE' && presence.present.length > 0,
        presentCount: presence.present.length,
        lastVisitedAt: m.lastVisitedAt.toISOString(),
      });
    }
    return {
      setSessions: items.filter((i) => i.session.isSet),
      openSessions: items.filter((i) => !i.session.isSet),
    };
  });

  /** Remove a set session from your list (owners must delete or transfer instead). */
  app.delete('/me/sessions/:id', auth, async (req) => {
    const { id } = sid.parse(req.params);
    const m = await requireMember(id, req.auth.userId);
    if (m.role === 'OWNER') throw badRequest('Owners must transfer ownership or delete the session');
    await hub().leave(id, req.auth.userId).catch(() => {});
    await prisma.sessionMember.delete({ where: { sessionId_userId: { sessionId: id, userId: req.auth.userId } } });
    app.io.to(rooms.session(id)).emit('member:removed', { sessionId: id, userId: req.auth.userId });
    return { ok: true };
  });

  // ---------------------------------------------------------------- settings

  app.patch('/sessions/:id', auth, async (req) => {
    const { id } = sid.parse(req.params);
    const body = updateSessionSchema.parse(req.body);
    const m = await requirePermission(id, req.auth.userId, 'session.editSettings');
    if (body.isSet !== undefined && body.isSet !== m.session.isSet) {
      if (!can(m.role, 'session.toggleSet')) throw forbidden('Only the owner can change this');
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: m.session.ownerId } });
      if (body.isSet && owner.isGuest) throw forbidden('Create an account to make set sessions', 'account_required');
    }
    const session = await prisma.session.update({ where: { id }, data: body });
    app.io.to(rooms.session(id)).emit('session:updated', toSessionDTO(session));
    return { session: toSessionDTO(session) };
  });

  app.post('/sessions/:id/rotate-code', auth, async (req) => {
    const { id } = sid.parse(req.params);
    await requirePermission(id, req.auth.userId, 'session.rotateCode');
    const session = await prisma.session.update({ where: { id }, data: { code: await uniqueCode() } });
    app.io.to(rooms.session(id)).emit('session:updated', toSessionDTO(session));
    return { session: toSessionDTO(session) };
  });

  app.delete('/sessions/:id', auth, async (req) => {
    const { id } = sid.parse(req.params);
    await requirePermission(id, req.auth.userId, 'session.delete');
    await hub().deleteSession(id);
    return { ok: true };
  });

  app.patch('/sessions/:id/members/me', auth, async (req) => {
    const { id } = sid.parse(req.params);
    const body = updateMemberSchema.parse(req.body);
    await requireMember(id, req.auth.userId);
    await prisma.sessionMember.update({
      where: { sessionId_userId: { sessionId: id, userId: req.auth.userId } },
      data: { nickname: body.nickname || null },
    });
    await emitMember(id, req.auth.userId);
    return { ok: true };
  });

  // ------------------------------------------------- notifications (per user)

  app.patch('/sessions/:id/notifications', auth, async (req) => {
    const { id } = sid.parse(req.params);
    const body = notifySettingsSchema.parse(req.body);
    await requireMember(id, req.auth.userId);
    const m = await prisma.sessionMember.update({
      where: { sessionId_userId: { sessionId: id, userId: req.auth.userId } },
      data: {
        notifyLevel: body.level,
        mutedUntil: body.mutedUntil === undefined ? undefined : body.mutedUntil ? new Date(body.mutedUntil) : null,
      },
    });
    return { notify: { level: m.notifyLevel, mutedUntil: m.mutedUntil?.toISOString() ?? null } };
  });

  // ------------------------------------------------------------- server mute

  app.post('/sessions/:id/server-mute/:userId', auth, async (req) => {
    const { id, userId } = sidUid.parse(req.params);
    const { muted } = serverMuteSchema.parse(req.body);
    const actor = await requirePermission(id, req.auth.userId, 'voice.serverMute');
    const target = await requireMember(id, userId).catch(() => null);
    if (!target) throw notFound('Member');
    if (userId === req.auth.userId || !canModerate(actor.role, target.role)) throw forbidden('You cannot mute this member');
    await applyServerMute(app, id, userId, muted);
    return { ok: true };
  });

  // -------------------------------------------------------- roles (by public id)

  async function memberByPublicId(sessionId: string, publicId: string) {
    const user = await prisma.user.findUnique({ where: { publicId: publicId.toUpperCase().trim() } });
    if (!user) throw notFound('User');
    const m = await prisma.sessionMember.findUnique({ where: { sessionId_userId: { sessionId, userId: user.id } } });
    if (!m) throw badRequest('That user has never joined this session', 'not_member');
    return m;
  }

  app.post('/sessions/:id/mods', auth, async (req) => {
    const { id } = sid.parse(req.params);
    const { publicId } = byPublicIdSchema.parse(req.body);
    await requirePermission(id, req.auth.userId, 'session.manageMods');
    const target = await memberByPublicId(id, publicId);
    if (target.role === 'OWNER') throw badRequest('The owner is already in charge');
    await prisma.sessionMember.update({
      where: { sessionId_userId: { sessionId: id, userId: target.userId } },
      data: { role: 'MOD' },
    });
    await emitMember(id, target.userId);
    return { ok: true };
  });

  app.delete('/sessions/:id/mods/:userId', auth, async (req) => {
    const { id, userId } = sidUid.parse(req.params);
    await requirePermission(id, req.auth.userId, 'session.manageMods');
    await prisma.sessionMember.updateMany({ where: { sessionId: id, userId, role: 'MOD' }, data: { role: 'MEMBER' } });
    await emitMember(id, userId);
    return { ok: true };
  });

  app.post('/sessions/:id/transfer', auth, async (req) => {
    const { id } = sid.parse(req.params);
    const { publicId } = byPublicIdSchema.parse(req.body);
    await requirePermission(id, req.auth.userId, 'session.transferOwnership');
    const target = await memberByPublicId(id, publicId);
    if (target.userId === req.auth.userId) throw badRequest('You already own this session');
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    const session = await prisma.session.findUniqueOrThrow({ where: { id } });
    if (session.isSet && targetUser.isGuest) throw badRequest('Set sessions can only be owned by registered accounts');
    const updated = await prisma.$transaction(async (tx) => {
      await tx.sessionMember.update({ where: { sessionId_userId: { sessionId: id, userId: req.auth.userId } }, data: { role: 'MOD' } });
      await tx.sessionMember.update({ where: { sessionId_userId: { sessionId: id, userId: target.userId } }, data: { role: 'OWNER' } });
      return tx.session.update({ where: { id }, data: { ownerId: target.userId } });
    });
    await emitMember(id, req.auth.userId);
    await emitMember(id, target.userId);
    app.io.to(rooms.session(id)).emit('session:updated', toSessionDTO(updated));
    return { ok: true };
  });

  // ---------------------------------------------------------- kick / ban

  app.post('/sessions/:id/kick/:userId', auth, async (req) => {
    const { id, userId } = sidUid.parse(req.params);
    const actor = await requirePermission(id, req.auth.userId, 'session.kick');
    const target = await requireMember(id, userId).catch(() => null);
    if (!target) throw notFound('Member');
    if (!canModerate(actor.role, target.role)) throw forbidden('You cannot kick this member');
    app.io.to(rooms.user(userId)).emit('session:removed', { sessionId: id, reason: 'kicked' });
    await kickFromSessionVoice(id, userId);
    await hub().leave(id, userId);
    return { ok: true };
  });

  app.get('/sessions/:id/bans', auth, async (req) => {
    const { id } = sid.parse(req.params);
    await requirePermission(id, req.auth.userId, 'session.ban');
    const bans = await prisma.sessionBan.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'desc' } });
    const users = await prisma.user.findMany({ where: { id: { in: bans.map((b) => b.userId) } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const out: BanDTO[] = bans
      .filter((b) => byId.has(b.userId))
      .map((b) => ({
        user: toPublicUser(byId.get(b.userId)!),
        reason: b.reason,
        bannedById: b.bannedById,
        createdAt: b.createdAt.toISOString(),
      }));
    return { bans: out };
  });

  /** Ban by userId (from member list) or by publicId (someone who isn't present). */
  app.post('/sessions/:id/bans', auth, async (req) => {
    const { id } = sid.parse(req.params);
    const body = banSchema
      .extend({ userId: z.string().uuid().optional(), publicId: z.string().optional() })
      .parse(req.body);
    const actor = await requirePermission(id, req.auth.userId, 'session.ban');
    const user = body.userId
      ? await prisma.user.findUnique({ where: { id: body.userId } })
      : body.publicId
        ? await prisma.user.findUnique({ where: { publicId: body.publicId.toUpperCase().trim() } })
        : null;
    if (!user) throw notFound('User');
    if (user.id === req.auth.userId) throw badRequest('You cannot ban yourself');
    const targetMember = await prisma.sessionMember.findUnique({
      where: { sessionId_userId: { sessionId: id, userId: user.id } },
    });
    if (!canModerate(actor.role, targetMember?.role ?? null)) throw forbidden('You cannot ban this member');

    const devices = await prisma.refreshToken.findMany({ where: { userId: user.id }, select: { deviceHash: true } });
    const deviceHashes = [...new Set(devices.map((d) => d.deviceHash))];
    await prisma.sessionBan.upsert({
      where: { sessionId_userId: { sessionId: id, userId: user.id } },
      create: { sessionId: id, userId: user.id, deviceHashes, reason: body.reason, bannedById: req.auth.userId },
      update: { deviceHashes, reason: body.reason, bannedById: req.auth.userId },
    });
    app.io.to(rooms.user(user.id)).emit('session:removed', { sessionId: id, reason: 'banned' });
    await kickFromSessionVoice(id, user.id);
    if (await hub().isPresent(id, user.id)) await hub().leave(id, user.id);
    if (targetMember) {
      await prisma.sessionMember.delete({ where: { sessionId_userId: { sessionId: id, userId: user.id } } });
      app.io.to(rooms.session(id)).emit('member:removed', { sessionId: id, userId: user.id });
    }
    return { ok: true };
  });

  app.delete('/sessions/:id/bans/:userId', auth, async (req) => {
    const { id, userId } = sidUid.parse(req.params);
    await requirePermission(id, req.auth.userId, 'session.ban');
    await prisma.sessionBan.deleteMany({ where: { sessionId: id, userId } });
    return { ok: true };
  });
}
