import { HttpError } from './errors';
import { redis } from './redis';

// Fixed window counter. INCR + PEXPIRE run as one script so a crash between them can't leave a key
// without an expiry, and every server instance shares the same count.
const COUNT_SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

/**
 * Per-account rate limit (the plugin's built-in limit is per IP, which lets one person with several
 * guest accounts flood a channel and makes everyone behind one shared IP slow each other down).
 * Throws 429 `rate_limited` once `userId` has used more than `max` calls of `bucket` in `windowMs`.
 * If Redis is unavailable the call is allowed: a hiccup there must not stop chat.
 */
export async function limitPerUser(userId: string, bucket: string, max: number, windowMs: number): Promise<void> {
  let count: number;
  let ttlMs: number;
  try {
    [count, ttlMs] = (await redis.eval(COUNT_SCRIPT, 1, `rl:${bucket}:${userId}`, windowMs)) as [number, number];
  } catch (err) {
    console.error('[rate-limit] redis unavailable, allowing', err);
    return;
  }
  if (count > max) {
    const seconds = Math.max(1, Math.ceil(Math.max(ttlMs, 0) / 1000));
    throw new HttpError(429, 'rate_limited', `You're sending messages too fast. Try again in ${seconds}s.`);
  }
}
