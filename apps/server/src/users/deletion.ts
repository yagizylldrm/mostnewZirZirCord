import { forgetActiveUser } from '../auth/tokens';
import { env } from '../env';
import { prisma } from '../lib/db';
import { withLock } from '../lib/redis';
import { toMemberDTO, toSessionDTO } from '../lib/serializers';
import { deleteKeys, deletePrefix } from '../lib/storage';
import { clearAccessCache } from '../sessions/access';
import { type IO, rooms, type SessionHub } from '../sessions/hub';
import { kickFromSessionVoice } from '../voice/livekit';

interface Ctx {
  io: IO;
  hub: SessionHub;
}

/**
 * Hands a session owned by `userId` on: mods first, then the member who joined
 * earliest. Set sessions prefer registered accounts; if only guests remain, the
 * chosen guest takes over and the session becomes temporary (guests can't own
 * set sessions). With nobody else left, the session is deleted.
 */
async function handOverSession(ctx: Ctx, sessionId: string, userId: string) {
  const outcome = await withLock(`sess:${sessionId}`, async () => {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.ownerId !== userId) return null;
    const others = await prisma.sessionMember.findMany({
      // deletedAt: guests closed by an older server version (they only linger to name old messages).
      where: { sessionId, userId: { not: userId }, user: { deletedAt: null } },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { firstVisitedAt: 'asc' }], // Role enum order OWNER, MOD, MEMBER → mods first
    });
    if (!others.length) return { deleted: true as const };
    const heir = (session.isSet && others.find((m) => !m.user.isGuest)) || others[0];
    const becomesTemporary = session.isSet && heir.user.isGuest;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.sessionMember.update({
        where: { sessionId_userId: { sessionId, userId: heir.userId } },
        data: { role: 'OWNER' },
      });
      return tx.session.update({
        where: { id: sessionId },
        data: { ownerId: heir.userId, ...(becomesTemporary ? { isSet: false } : {}) },
      });
    });
    return { deleted: false as const, updated, heirId: heir.userId };
  });
  if (!outcome) return;
  if (outcome.deleted) {
    await ctx.hub.deleteSession(sessionId);
    return;
  }
  const heir = await prisma.sessionMember.findUnique({
    where: { sessionId_userId: { sessionId, userId: outcome.heirId } },
    include: { user: true },
  });
  if (heir) ctx.io.to(rooms.session(sessionId)).emit('member:upsert', { sessionId, member: toMemberDTO(heir) });
  ctx.io.to(rooms.session(sessionId)).emit('session:updated', toSessionDTO(outcome.updated));
  // A set session that turned temporary while nobody is in it must close like any empty temporary session.
  if (!outcome.updated.isSet && !(await ctx.hub.getPresence(sessionId)).present.length) ctx.hub.scheduleEmptyCheck(sessionId);
}

/**
 * Permanently deletes an account. Messages stay (author becomes "Deleted user"),
 * owned sessions are handed over, and profile media / stickers are removed.
 */
export async function deleteUserAccount(ctx: Ctx, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
  if (!user) return;

  // 1. Leave every session and voice room. (Empty temporary sessions close here.)
  for (const m of user.memberships) {
    await kickFromSessionVoice(m.sessionId, userId);
    if (await ctx.hub.isPresent(m.sessionId, userId)) await ctx.hub.leave(m.sessionId, userId).catch(() => {});
  }

  // 2. Hand over (or delete) the sessions they still own.
  const owned = await prisma.session.findMany({ where: { ownerId: userId }, select: { id: true } });
  for (const s of owned) await handOverSession(ctx, s.id, userId);

  // 3. Files only this user had: profile media, stickers, unfinished uploads.
  const pending = await prisma.attachment.findMany({
    where: { uploaderId: userId, messageId: null },
    select: { id: true, storageKey: true, thumbnailKey: true },
  });
  await deleteKeys(pending.flatMap((a) => [a.storageKey, a.thumbnailKey].filter(Boolean) as string[])).catch(() => {});
  await prisma.attachment.deleteMany({ where: { id: { in: pending.map((a) => a.id) } } });
  for (const prefix of ['avatars', 'banners', 'stickers', 'sticker-uploads', 'session-icon-uploads']) {
    await deletePrefix(`${prefix}/${userId}/`).catch(() => {});
  }
  await prisma.channelMute.deleteMany({ where: { userId } });

  // 4. The account itself. Cascades tokens, memberships, stickers; messages keep a null author.
  //    Session/channel bans are kept on purpose: their device hashes still block evasion.
  const sessionIds = (await prisma.sessionMember.findMany({ where: { userId }, select: { sessionId: true } })).map((m) => m.sessionId);
  await prisma.user.delete({ where: { id: userId } });
  forgetActiveUser(userId);
  clearAccessCache();

  // 5. Tell everyone, then cut this user's live connections.
  for (const sessionId of sessionIds) {
    ctx.io.to(rooms.session(sessionId)).emit('user:deleted', { sessionId, userId });
    ctx.io.to(rooms.session(sessionId)).emit('member:removed', { sessionId, userId });
  }
  ctx.io.to(rooms.user(userId)).emit('account:deleted', { userId });
  ctx.io.in(rooms.user(userId)).disconnectSockets(true);
}

/**
 * Deletes guest accounts that have been offline longer than GUEST_TTL_HOURS.
 * Guests that are connected right now are skipped (and their timestamp bumped).
 */
export async function cleanupOfflineGuests(ctx: Ctx, now = Date.now()) {
  const cutoff = new Date(now - env.GUEST_TTL_HOURS * 60 * 60 * 1000);
  let deleted = 0;
  const failed: string[] = [];
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { isGuest: true, lastSeenAt: { lt: cutoff }, id: { notIn: failed } },
      select: { id: true },
      take: 50,
    });
    if (!batch.length) break;
    for (const { id } of batch) {
      if ((await ctx.io.in(rooms.user(id)).fetchSockets()).length) {
        await prisma.user.update({ where: { id }, data: { lastSeenAt: new Date() } });
        continue;
      }
      try {
        await deleteUserAccount(ctx, id);
        deleted++;
      } catch (err) {
        console.error(`[guests] could not delete ${id}`, err);
        failed.push(id);
      }
    }
    if (batch.length < 50) break;
  }
  return deleted;
}
