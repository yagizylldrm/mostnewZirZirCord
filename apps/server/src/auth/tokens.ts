import { createHash, createHmac, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env';
import { prisma } from '../lib/db';
import { unauthorized } from '../lib/errors';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface AuthContext {
  userId: string;
  deviceHash: string;
}

/** Device ids are never stored raw; only an HMAC (used for ban-evasion checks). */
export function hashDevice(deviceId: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(`device:${deviceId}`).digest('hex');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function signAccessToken(ctx: AuthContext): Promise<string> {
  return new SignJWT({ did: ctx.deviceHash })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ctx.userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.did !== 'string') throw new Error('bad token');
    return { userId: payload.sub, deviceHash: payload.did };
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
}

/** Short cache so every request doesn't hit the DB; closed/deleted accounts stop working within seconds. */
const activeCache = new Map<string, number>();
export function forgetActiveUser(userId: string) {
  activeCache.delete(userId);
}
export async function assertUserActive(userId: string) {
  const until = activeCache.get(userId);
  if (until && until > Date.now()) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
  if (!u || u.deletedAt) {
    activeCache.delete(userId);
    throw unauthorized('Session expired, please sign in again');
  }
  if (activeCache.size > 5000) activeCache.clear();
  activeCache.set(userId, Date.now() + 10_000);
}

export async function issueTokens(userId: string, deviceHash: string) {
  const refreshToken = randomBytes(48).toString('base64url');
  // Housekeeping: drop expired rows and keep at most 20 live tokens per user (oldest go first).
  await prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  const stale = await prisma.refreshToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: 19,
    select: { id: true },
  });
  if (stale.length) await prisma.refreshToken.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
  await prisma.refreshToken.create({
    data: {
      userId,
      deviceHash,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  const accessToken = await signAccessToken({ userId, deviceHash });
  return { accessToken, refreshToken };
}

/** Rotates a refresh token (old one is consumed). */
export async function rotateRefreshToken(refreshToken: string, deviceHash: string) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
  if (!row || row.expiresAt < new Date() || row.deviceHash !== deviceHash) {
    if (row) await prisma.refreshToken.delete({ where: { id: row.id } }).catch(() => {});
    throw unauthorized('Session expired, please sign in again');
  }
  // Atomic consume: a concurrent second use of the same token must fail.
  const consumed = await prisma.refreshToken.deleteMany({ where: { id: row.id } });
  if (consumed.count !== 1) throw unauthorized('Session expired, please sign in again');
  await assertUserActive(row.userId);
  return { userId: row.userId, ...(await issueTokens(row.userId, deviceHash)) };
}

/** Revokes a refresh token and returns the id of the user it belonged to (null if unknown). */
export async function revokeRefreshToken(refreshToken: string): Promise<string | null> {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, select: { userId: true } });
  await prisma.refreshToken.deleteMany({ where: { tokenHash: sha256(refreshToken) } });
  return row?.userId ?? null;
}
