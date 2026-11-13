import { env } from '../env';
import { prisma } from '../lib/db';
import { withLock } from '../lib/redis';
import { toSessionDTO } from '../lib/serializers';
import { clearAccessCache } from './access';
import { type IO, rooms, type SessionHub } from './hub';

interface Ctx {
  io: IO;
  hub: SessionHub;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Set sessions nobody entered or wrote in for SESSION_SLEEP_DAYS fall asleep
 * (💤 in the clients; opening one wakes it, see SessionHub.enter). Sessions asleep
 * for SESSION_DELETE_AFTER_SLEEP_DAYS are deleted with all their messages and files.
 */
export async function sweepSleepingSessions(ctx: Ctx, now = Date.now()) {
  let slept = 0;
  let deleted = 0;

  const idle = await prisma.session.findMany({
    where: { isSet: true, sleepingSince: null, lastActiveAt: { lt: new Date(now - env.SESSION_SLEEP_DAYS * DAY_MS) } },
    select: { id: true },
  });
  for (const { id } of idle) {
    const session = await withLock(`sess:${id}`, async () => {
      // Someone sitting in it right now counts as activity.
      if ((await ctx.hub.getPresence(id)).present.length) {
        await prisma.session.update({ where: { id }, data: { lastActiveAt: new Date(now) } });
        return null;
      }
      const res = await prisma.session.updateMany({ where: { id, sleepingSince: null }, data: { sleepingSince: new Date(now) } });
      return res.count ? prisma.session.findUnique({ where: { id } }) : null;
    });
    if (!session) continue;
    slept++;
    clearAccessCache();
    ctx.io.to(rooms.session(id)).emit('session:updated', toSessionDTO(session));
  }

  const expired = await prisma.session.findMany({
    where: { sleepingSince: { lt: new Date(now - env.SESSION_DELETE_AFTER_SLEEP_DAYS * DAY_MS) } },
    select: { id: true },
  });
  for (const { id } of expired) {
    // Re-check: it may have been woken between the query and now.
    if ((await ctx.hub.getPresence(id)).present.length) continue;
    await ctx.hub.deleteSession(id, 'expired');
    deleted++;
  }
  return { slept, deleted };
}
