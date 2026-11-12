import { buildApp } from './app';
import { env } from './env';
import { prisma } from './lib/db';
import { cleanupInactiveGuests } from './lib/guests';
import { redis } from './lib/redis';
import { ensureBucket } from './lib/storage';
import { cleanupPendingUploads } from './uploads/routes';
import { startVoiceSync } from './voice/sync';

async function main() {
  await ensureBucket();
  const app = await buildApp();
  await app.hub.recover();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  startVoiceSync(app.hub);

  const cleanup = setInterval(() => cleanupPendingUploads().catch((e) => app.log.warn(e)), 60 * 60 * 1000);
  cleanup.unref();

  // Guests who haven't been back for GUEST_INACTIVE_DAYS: shortly after boot, then every 6 hours.
  const guestCleanup = () => cleanupInactiveGuests(app).catch((e) => app.log.warn(e));
  setTimeout(guestCleanup, 60 * 1000).unref();
  setInterval(guestCleanup, 6 * 60 * 60 * 1000).unref();

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
