import type { FastifyInstance } from 'fastify';
import { rooms } from '../sessions/hub';
import { forgetActiveUser } from '../auth/tokens';
import { prisma } from './db';
import { toMemberDTO, toSessionDTO } from './serializers';
import { deleteKeys } from './storage';

/** Guests not seen for this long are closed by the daily cleanup. */
export const GUEST_INACTIVE_DAYS = 30;

/**
 * Closes a guest account (on logout, or after GUEST_INACTIVE_DAYS of inactivity).
 * A guest can never sign in again once logged out, so the account is useless after that.
 *
 * - Sessions it still owns go to the longest-standing other member (or are deleted if empty).
 * - No messages → the user row is deleted outright.
 * - Messages others can still see → the name stays so the chat history keeps making sense;
 *   profile pictures, bio, stickers, sign-in tokens and memberships of sessions it never wrote
 *   in are removed. The user is flagged `isDeleted`, which hides it from member lists.
 *
 * Returns what happened, or null when the user isn't an open guest account.
 */
export async function closeGuest(app: FastifyInstance, userId: string): Promise<'deleted' | 'anonymized' | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { stickers: true } });
  if (!user || !user.isGuest || user.deletedAt) return null;

  forgetActiveUser(userId);
  // Other tabs/devices still holding a connection must not keep acting as this guest.
  app.io.in(rooms.user(userId)).disconnectSockets(true);

  const memberships = await prisma.sessionMember.findMany({ where: { userId }, select: { sessionId: true } });
  for (const { sessionId } of memberships) {
    if (await app.hub.isPresent(sessionId, userId)) await app.hub.leave(sessionId, userId);
  }
  await handOverOwnedSessions(app, userId);

  const files = [user.avatarKey, user.avatarStaticKey, user.bannerKey, user.bannerStaticKey, ...user.stickers.flatMap((s) => [s.storageKey, `${s.storageKey}.still.webp`])].filter(
    (k): k is string => !!k,
  );

  let result: 'deleted' | 'anonymized';
  let kept: string[] = [];
  if ((await prisma.message.count({ where: { authorId: userId } })) === 0) {
    await prisma.$transaction([prisma.channelMute.deleteMany({ where: { userId } }), prisma.user.delete({ where: { id: userId } })]);
    result = 'deleted';
  } else {
    // Clients name message authors from the session's member list, so keep the membership
    // (as a plain member) wherever the guest wrote something; drop it everywhere else.
    const wroteIn = await prisma.channel.findMany({
      where: { messages: { some: { authorId: userId } } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });
    const keep = wroteIn.map((c) => c.sessionId);
    await prisma.$transaction([
      prisma.refreshToken.deleteMany({ where: { userId } }),
      prisma.sessionMember.deleteMany({ where: { userId, sessionId: { notIn: keep } } }),
      prisma.sessionMember.updateMany({ where: { userId }, data: { role: 'MEMBER', serverMuted: false, mutedUntil: null } }),
      prisma.sticker.deleteMany({ where: { ownerId: userId } }),
      prisma.channelMute.deleteMany({ where: { userId } }),
      prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), avatarKey: null, avatarStaticKey: null, bannerKey: null, bannerStaticKey: null, bio: '', status: 'INVISIBLE' },
      }),
    ]);
    result = 'anonymized';
    kept = keep;
  }

  // Update open clients: flagged members disappear from lists but keep naming old messages.
  for (const { sessionId } of memberships) {
    const member = kept.includes(sessionId)
      ? await prisma.sessionMember.findUnique({ where: { sessionId_userId: { sessionId, userId } }, include: { user: true } })
      : null;
    if (member) app.io.to(rooms.session(sessionId)).emit('member:upsert', { sessionId, member: toMemberDTO(member) });
    else app.io.to(rooms.session(sessionId)).emit('member:removed', { sessionId, userId });
  }

  if (files.length) await deleteKeys(files).catch((e) => app.log.warn(e, 'guest file cleanup failed'));
  return result;
}

/** Gives every session the guest owns to the longest-standing other member, or deletes it if nobody else is left. */
async function handOverOwnedSessions(app: FastifyInstance, userId: string) {
  const owned = await prisma.session.findMany({ where: { ownerId: userId } });
  for (const session of owned) {
    const successor = await prisma.sessionMember.findFirst({
      where: { sessionId: session.id, userId: { not: userId }, user: { deletedAt: null, ...(session.isSet ? { isGuest: false } : {}) } },
      orderBy: [{ role: 'asc' }, { firstVisitedAt: 'asc' }], // enum order OWNER, MOD, MEMBER: mods first, then the oldest member
    });
    if (!successor) {
      await app.hub.deleteSession(session.id);
      continue;
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.sessionMember.update({ where: { sessionId_userId: { sessionId: session.id, userId: successor.userId } }, data: { role: 'OWNER' } });
      return tx.session.update({ where: { id: session.id }, data: { ownerId: successor.userId } });
    });
    const member = await prisma.sessionMember.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: successor.userId } },
      include: { user: true },
    });
    if (member) app.io.to(rooms.session(session.id)).emit('member:upsert', { sessionId: session.id, member: toMemberDTO(member) });
    app.io.to(rooms.session(session.id)).emit('session:updated', toSessionDTO(updated));
  }
}

/** Closes guests who haven't been seen for GUEST_INACTIVE_DAYS. */
export async function cleanupInactiveGuests(app: FastifyInstance) {
  const cutoff = new Date(Date.now() - GUEST_INACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.user.findMany({
    where: { isGuest: true, deletedAt: null, lastSeenAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });
  let closed = 0;
  for (const { id } of stale) {
    // lastSeenAt only moves on connect/refresh, so a tab left open for weeks can look stale.
    if ((await app.io.in(rooms.user(id)).fetchSockets()).length > 0) {
      await prisma.user.update({ where: { id }, data: { lastSeenAt: new Date() } });
      continue;
    }
    try {
      if (await closeGuest(app, id)) closed++;
    } catch (e) {
      app.log.warn(e, `closing inactive guest ${id} failed`);
    }
  }
  if (closed) app.log.info(`closed ${closed} inactive guest account(s)`);
  return closed;
}
