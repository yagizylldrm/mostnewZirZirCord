import { buildApp } from './app';
import { env } from './env';
import { prisma } from './lib/db';
import { redis } from './lib/redis';
import { ensureBucket } from './lib/storage';
import { cleanupPendingUploads } from './uploads/routes';
import { sweepSleepingSessions } from './sessions/sleep';
import { cleanupOfflineGuests } from './users/deletion';
import { startVoiceSync } from './voice/sync';

async function main() {
  await ensureBucket();
  const app = await buildApp();
  await app.hub.recover();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  startVoiceSync(app.hub);

  const cleanup = setInterval(() => cleanupPendingUploads().catch((e) => app.log.warn(e)), 60 * 60 * 1000);
  cleanup.unref();

  // Guests offline for GUEST_TTL_HOURS are deleted (checked every 15 min and at boot).
  const sweepGuests = () =>
    cleanupOfflineGuests(app)
      .then((n) => n && app.log.info(`deleted ${n} offline guest account(s)`))
      .catch((e) => app.log.warn(e));
  setTimeout(sweepGuests, 60_000).unref();
  setInterval(sweepGuests, 15 * 60 * 1000).unref();

  // Idle set sessions fall asleep, long-sleeping ones are deleted (hourly, and 2 min after boot).
  const sweepSessions = () =>
    sweepSleepingSessions(app)
      .then(({ slept, deleted }) => (slept || deleted) && app.log.info(`sessions: ${slept} fell asleep, ${deleted} deleted after sleeping`))
      .catch((e) => app.log.warn(e));
  setTimeout(sweepSessions, 2 * 60_000).unref();
  setInterval(sweepSessions, 60 * 60 * 1000).unref();

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
