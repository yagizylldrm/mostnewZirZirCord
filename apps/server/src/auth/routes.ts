import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { guestAuthSchema, loginSchema, refreshSchema, registerSchema, upgradeSchema } from '@zirzircord/shared';
import type { AuthResponse } from '@zirzircord/shared';
import { prisma } from '../lib/db';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { toSelfUser } from '../lib/serializers';
import { createUserWithPublicId } from '../lib/users';
import { hashDevice, issueTokens, revokeRefreshToken, rotateRefreshToken } from './tokens';

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
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, body.password))) {
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
    if (body.refreshToken) await revokeRefreshToken(body.refreshToken);
    return { ok: true };
  });
}
