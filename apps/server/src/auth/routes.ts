import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { guestAuthSchema, loginSchema, refreshSchema, registerSchema, upgradeSchema } from '@zirzircord/shared';
import type { AuthResponse } from '@zirzircord/shared';
import { prisma } from '../lib/db';
import { HttpError, badRequest, conflict, unauthorized } from '../lib/errors';
import { redis } from '../lib/redis';
import { deleteUserAccount } from '../users/deletion';
import { toSelfUser } from '../lib/serializers';
import { createUserWithPublicId } from '../lib/users';
import { findRefreshTokenOwner, hashDevice, issueTokens, revokeRefreshToken, rotateRefreshToken } from './tokens';

/** Verified against for unknown emails, so a login takes the same time either way. */
const DUMMY_HASH = argon2.hash('zirzircord-timing-equaliser');
const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCK_SECONDS = 15 * 60;

export async function authRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  // Guests are free to make, so creating them is limited harder (ban evasion, spam).
  app.post('/auth/guest', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req): Promise<AuthResponse> => {
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
    // Per-account lockout on top of the per-IP limit (stops distributed guessing).
    const failKey = `loginfail:${email}`;
    if (Number(await redis.get(failKey)) >= LOGIN_MAX_FAILURES) {
      throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Try again in 15 minutes.');
    }
    const user = await prisma.user.findUnique({ where: { email } });
    const ok = await argon2.verify(user?.passwordHash ?? (await DUMMY_HASH), body.password);
    if (!user?.passwordHash || !ok) {
      await redis.multi().incr(failKey).expire(failKey, LOGIN_LOCK_SECONDS).exec();
      throw unauthorized('Wrong email or password');
    }
    await redis.del(failKey);
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
    if (typeof body.refreshToken === 'string') {
      // Guests have nothing to come back to: logging out deletes the guest account.
      const owner = await findRefreshTokenOwner(body.refreshToken);
      if (owner?.isGuest) await deleteUserAccount(app, owner.id);
      else await revokeRefreshToken(body.refreshToken);
    }
    return { ok: true };
  });
}
