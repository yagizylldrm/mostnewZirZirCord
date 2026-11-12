import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { env } from '../env';

// family: 0 resolves both IPv4 and IPv6, so private hostnames like *.railway.internal also work.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, family: 0 });

const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Runs `fn` while holding a Redis lock, so concurrent joins/leaves/closes of the
 * same session are serialised (also across multiple server instances).
 */
export async function withLock<T>(name: string, fn: () => Promise<T>, ttlMs = 10_000): Promise<T> {
  const key = `lock:${name}`;
  const token = randomUUID();
  const deadline = Date.now() + ttlMs;
  while (true) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok) break;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${name}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_LUA, 1, key, token);
  }
}
