import type { SessionMember } from '@prisma/client';
import { SPAM } from '@zirzircord/shared';
import { clearAccessCache } from '../sessions/access';
import { type IO, rooms } from '../sessions/hub';
import { prisma } from './db';
import { forbidden, tooMany } from './errors';
import { redis } from './redis';
import { toMemberDTO } from './serializers';

const STRIKE_TTL_S = 60 * 60;

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
};

/** Throws while a member is timed out (automatic spam timeout or set by a moderator). */
export function assertNotTimedOut(member: Pick<SessionMember, 'timeoutUntil'>) {
  const until = member.timeoutUntil?.getTime() ?? 0;
  if (until > Date.now()) {
    throw forbidden(`You are timed out for ${fmt(until - Date.now())}`, 'timed_out');
  }
}

/** Counts one event in a fixed window. Returns true when the limit is exceeded. */
async function overLimit(key: string, max: number, windowMs: number) {
  const [[, n]] = (await redis.multi().incr(key).pexpire(key, windowMs, 'NX').exec()) as [[null, number], unknown];
  return n > max;
}

/** Writes a timeout, tells the session, and refreshes cached permissions. */
export async function setTimeoutUntil(io: IO, sessionId: string, userId: string, until: Date | null) {
  const m = await prisma.sessionMember.update({
    where: { sessionId_userId: { sessionId, userId } },
    data: { timeoutUntil: until },
    include: { user: true },
  });
  clearAccessCache();
  io.to(rooms.session(sessionId)).emit('member:upsert', { sessionId, member: toMemberDTO(m) });
  return m;
}

/**
 * Per-user message limit (per session and across all sessions). Going over is a
 * strike: 1 min → 5 min → 15 min timeouts, strikes forgotten after an hour.
 */
export async function hitMessageLimit(io: IO, sessionId: string, userId: string) {
  const [inSession, everywhere] = await Promise.all([
    overLimit(`spam:msg:${sessionId}:${userId}`, SPAM.sessionMax, SPAM.sessionWindowMs),
    overLimit(`spam:msg:*:${userId}`, SPAM.globalMax, SPAM.globalWindowMs),
  ]);
  if (!inSession && !everywhere) return;

  const strikeKey = `spam:strikes:${sessionId}:${userId}`;
  const [[, strikes]] = (await redis.multi().incr(strikeKey).expire(strikeKey, STRIKE_TTL_S).exec()) as [[null, number], unknown];
  const ms = SPAM.timeoutsMs[Math.min(strikes, SPAM.timeoutsMs.length) - 1];
  const until = new Date(Date.now() + ms);
  // Reset the windows so the timeout, not the counter, decides when they can write again.
  await redis.del(`spam:msg:${sessionId}:${userId}`, `spam:msg:*:${userId}`);
  await setTimeoutUntil(io, sessionId, userId, until);
  throw tooMany(`Slow down! You are timed out for ${fmt(ms)} for sending messages too fast.`, 'timed_out', { until: until.toISOString() });
}

/** Reactions: a plain limit, no strikes. */
export async function hitReactionLimit(userId: string) {
  if (await overLimit(`spam:react:${userId}`, SPAM.reactionMax, SPAM.reactionWindowMs)) {
    throw tooMany('You are reacting too fast', 'rate_limited');
  }
}
