import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { guestAuthSchema, loginSchema, refreshSchema, registerSchema, upgradeSchema } from '@zirzircord/shared';
import type { AuthResponse } from '@zirzircord/shared';
import { prisma } from '../lib/db';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { closeGuest } from '../lib/guests';
import { toSelfUser } from '../lib/serializers';
import { createUserWithPublicId } from '../lib/users';
import { hashDevice, issueTokens, revokeRefreshToken, rotateRefreshToken } from './tokens';

// Valid argon2id hash of a random string, only used to equalise timing for unknown emails.
const DUMMY_HASH = argon2.hash(randomBytes(16).toString('hex'));

// Per-account throttle on top of the per-IP limit (stops one IP-rotating attacker hammering one email).
const loginFails = new Map<string, { n: number; reset: number }>();
function loginBlocked(email: string) {
  const e = loginFails.get(email);
  return !!e && e.reset > Date.now() && e.n >= 10;
}
function noteLoginFail(email: string) {
  const now = Date.now();
  const e = loginFails.get(email);
  if (!e || e.reset < now) loginFails.set(email, { n: 1, reset: now + 15 * 60_000 });
  else e.n++;
  if (loginFails.size > 10_000) loginFails.clear();
}

export async function authRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/auth/guest', limited, async (req): Promise<AuthResponse> => {
    const body = guestAuthSchema.parse(req.body);
    const user = await createUserWithPublicId({ displayName: body.displayName, isGuest: true });
    const tokens = await issueTokens(user.id, hashDevice(body.deviceId));
    return { ...tokens, user: toSelfUser(user) };
  });

  app.post('/auth/register', limited, async (req): Promise<AuthResponse> => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict('That email is already registered', 'email_taken');
    const user = await createUserWithPublicId({
      displayName: body.displayName,
      isGuest: false,
      email,
      passwordHash: await argon2.hash(body.password),
    });
    const tokens = await issueTokens(user.id, hashDevice(body.deviceId));
    return { ...tokens, user: toSelfUser(user) };
  });

  app.post('/auth/login', limited, async (req): Promise<AuthResponse> => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase();
    if (loginBlocked(email)) throw badRequest('Too many attempts, try again in a few minutes', 'rate_limited');
    const user = await prisma.user.findUnique({ where: { email } });
    // Always run a verify so unknown emails take as long as wrong passwords.
    const ok = await argon2.verify(user?.passwordHash ?? (await DUMMY_HASH), body.password).catch(() => false);
    if (!user?.passwordHash || !ok) {
      noteLoginFail(email);
      throw unauthorized('Wrong email or password');
    }
    const tokens = await issueTokens(user.id, hashDevice(body.deviceId));
    return { ...tokens, user: toSelfUser(user) };
  });

  /** Guest → full account. Keeps the same id and public id, so sessions/roles carry over. */
  app.post('/auth/upgrade', { ...limited, preHandler: app.authenticate }, async (req) => {
    const body = upgradeSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.userId } });
    if (!user.isGuest) throw badRequest('This account is already registered');
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict('That email is already registered', 'email_taken');
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isGuest: false, email, passwordHash: await argon2.hash(body.password) },
    });
    return { user: toSelfUser(updated) };
  });

  app.post('/auth/refresh', limited, async (req) => {
    const body = refreshSchema.parse(req.body);
    const { userId, accessToken, refreshToken } = await rotateRefreshToken(body.refreshToken, hashDevice(body.deviceId));
    await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
    return { accessToken, refreshToken };
  });

  app.post('/auth/logout', async (req) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    if (typeof body.refreshToken !== 'string') return { ok: true };
    const userId = await revokeRefreshToken(body.refreshToken);
    // A guest has no password, so after logging out nobody can ever use the account again.
    if (userId) await closeGuest(app, userId);
    return { ok: true };
  });
}
