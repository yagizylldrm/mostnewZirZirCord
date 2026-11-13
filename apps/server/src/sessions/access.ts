import type { Role } from '@zirzircord/shared';
import type { Channel, Session, SessionMember } from '@prisma/client';
import { prisma } from '../lib/db';
import { forbidden, notFound } from '../lib/errors';

export async function getSessionOr404(sessionId: string) {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound('Session');
  return s;
}

/** Throws unless the user is a member of the session. Returns membership + session. */
export async function requireMember(sessionId: string, userId: string) {
  const m = await prisma.sessionMember.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    include: { session: true },
  });
  if (!m) throw notFound('Session');
  return m;
}

export async function getRole(sessionId: string, userId: string): Promise<Role | null> {
  const m = await prisma.sessionMember.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

export async function isSessionBanned(sessionId: string, userId: string, deviceHash: string) {
  const ban = await prisma.sessionBan.findFirst({
    where: { sessionId, OR: [{ userId }, { deviceHashes: { has: deviceHash } }] },
    select: { id: true },
  });
  return !!ban;
}

interface AccessResult {
  channel: Channel;
  session: Session;
  member: SessionMember;
}

/**
 * Channel access decisions are cached for a few seconds: posting a burst of
 * messages shouldn't cost a database round trip each. Any state-changing
 * request (bans, kicks, role/settings changes, channel edits...) clears the
 * cache — see the onResponse hook in app.ts — as do session close/sleep.
 */
const ACCESS_TTL_MS = 5000;
const accessCache = new Map<string, { at: number; value: AccessResult }>();
export function clearAccessCache() {
  accessCache.clear();
}

const DATE_KEYS = new Set(['createdAt', 'firstVisitedAt', 'lastVisitedAt', 'mutedUntil', 'timeoutUntil', 'lastActiveAt', 'sleepingSince', 'editedAt']);
// Prisma stores DateTime as UTC "timestamp without time zone"; row_to_json drops the zone, so add it back.
const utc = (v: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
const revive = <T>(o: Record<string, unknown> | null): T | null => {
  if (!o) return null;
  for (const k of Object.keys(o)) if (DATE_KEYS.has(k) && typeof o[k] === 'string') o[k] = utc(o[k] as string);
  return o as T;
};

/**
 * Loads a channel and checks the user can access it (member + not channel-banned).
 * One database round trip instead of four (channel, membership, session, ban).
 */
export async function requireChannelAccess(channelId: string, userId: string): Promise<AccessResult> {
  const key = `${channelId}:${userId}`;
  const hit = accessCache.get(key);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.value;

  const rows = await prisma.$queryRaw<{ channel: Record<string, unknown>; session: Record<string, unknown>; member: Record<string, unknown> | null; banned: boolean }[]>`
    SELECT row_to_json(c.*) AS channel,
           row_to_json(s.*) AS session,
           row_to_json(m.*) AS member,
           EXISTS (SELECT 1 FROM "ChannelBan" b WHERE b."channelId" = c.id AND b."userId" = ${userId}::uuid) AS banned
    FROM "Channel" c
    JOIN "Session" s ON s.id = c."sessionId"
    LEFT JOIN "SessionMember" m ON m."sessionId" = c."sessionId" AND m."userId" = ${userId}::uuid
    WHERE c.id = ${channelId}::uuid`;
  const row = rows[0];
  if (!row) throw notFound('Channel');
  if (!row.member) throw notFound('Session');
  if (row.banned) throw forbidden('You are banned from this channel', 'channel_banned');
  const value = { channel: revive<Channel>(row.channel)!, session: revive<Session>(row.session)!, member: revive<SessionMember>(row.member)! };
  accessCache.set(key, { at: Date.now(), value });
  if (accessCache.size > 5000) accessCache.delete(accessCache.keys().next().value!);
  return value;
}
