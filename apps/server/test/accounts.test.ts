import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/db';
import { headObject, putObject } from '../src/lib/storage';
import { cleanupOfflineGuests } from '../src/users/deletion';
import { Client, sleep, startServer } from './helpers';

let app: FastifyInstance;
let base: string;
const clients: Client[] = [];
const mk = () => {
  const c = new Client(base);
  clients.push(c);
  return c;
};

beforeAll(async () => {
  ({ app, base } = await startServer());
});
afterAll(async () => {
  clients.forEach((c) => c.close());
  await app.close();
});

/** Registers with a known email + password (Client.register hides them). */
async function registered(name: string) {
  const c = mk();
  const email = `${randomUUID()}@test.local`;
  const r = await c.req('POST', '/auth/register', { displayName: name, email, password: 'password123', deviceId: c.deviceId });
  Object.assign(c, { token: r.body.accessToken, refreshToken: r.body.refreshToken, userId: r.body.user.id, publicId: r.body.user.publicId });
  return Object.assign(c, { email });
}

async function sessionWith(owner: Client, body: Record<string, unknown>, ...others: Client[]) {
  const s = (await owner.req('POST', '/sessions', { name: 'Accounts', ...body })).body.session;
  const snap = await owner.enter(s.id);
  for (const o of others) {
    await o.req('POST', '/sessions/join', { code: s.code });
    await o.enter(s.id);
    await sleep(5); // distinct firstVisitedAt ordering
  }
  return { s, text: snap.channels.find((c) => c.type === 'TEXT')!, voice: snap.channels.find((c) => c.type === 'VOICE')! };
}

async function uploadAvatar(c: Client) {
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#33aa33' } }).png().toBuffer();
  const t = await c.req('POST', '/me/media-upload', { purpose: 'avatar', mime: 'image/png', size: buf.length });
  await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.headers, body: new Uint8Array(buf) });
  expect((await c.req('PATCH', '/me', { avatarUploadId: t.body.attachmentId })).status).toBe(200);
}

describe('guest accounts', () => {
  it('logging out deletes the guest; messages stay as "Deleted user"; ownership passes to the oldest member', async () => {
    const guest = await (await mk().guest('Leaving guest')).connect();
    const first = await (await mk().guest('First joiner')).connect();
    const second = await (await mk().guest('Second joiner')).connect();
    const { s, text } = await sessionWith(guest, {}, first, second);
    await uploadAvatar(guest);
    const avatarKey = (await prisma.user.findUniqueOrThrow({ where: { id: guest.userId } })).avatarKey!;
    expect(await headObject(avatarKey)).not.toBeNull();
    const sent = (await guest.req('POST', `/channels/${text.id}/messages`, { content: 'bye all' })).body.message;

    guest.close();
    expect((await mk().req('POST', '/auth/logout', { refreshToken: guest.refreshToken })).status).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: guest.userId } })).toBeNull();
    expect(await headObject(avatarKey)).toBeNull();
    await first.waitFor('member:removed', (p) => p.userId === guest.userId);
    const upsert = await first.waitFor('member:upsert', (p) => p.member.user.id === first.userId && p.member.role === 'OWNER');
    expect(upsert.member.role).toBe('OWNER');
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).ownerId).toBe(first.userId);

    const history = (await second.req('GET', `/channels/${text.id}/messages`)).body.messages;
    const kept = history.find((m: { id: string }) => m.id === sent.id);
    expect(kept.content).toBe('bye all');
    expect(kept.authorId).toBeNull();
  });

  it('a session owned by a deleted guest with nobody else in it is deleted', async () => {
    const guest = await (await mk().guest('Alone')).connect();
    const { s } = await sessionWith(guest, {});
    guest.close();
    await mk().req('POST', '/auth/logout', { refreshToken: guest.refreshToken });
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });

  it('cleanupOfflineGuests deletes guests offline for 24 h, but not connected guests or accounts', async () => {
    const stale = await mk().guest('Stale');
    const online = await (await mk().guest('Online')).connect();
    const account = await registered('Account');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.user.updateMany({ where: { id: { in: [stale.userId, online.userId, account.userId] } }, data: { lastSeenAt: old } });

    await cleanupOfflineGuests(app);

    expect(await prisma.user.findUnique({ where: { id: stale.userId } })).toBeNull();
    const kept = await prisma.user.findUniqueOrThrow({ where: { id: online.userId } });
    expect(kept.lastSeenAt.getTime()).toBeGreaterThan(old.getTime());
    expect(await prisma.user.findUnique({ where: { id: account.userId } })).not.toBeNull();
    // The deleted guest's tokens no longer work.
    expect((await stale.req('POST', '/auth/refresh', { refreshToken: stale.refreshToken, deviceId: stale.deviceId })).status).toBe(401);
  });

  it('guest creation is limited per IP', async () => {
    const c = mk();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await c.req('POST', '/auth/guest', { displayName: `g${i}`, deviceId: `d-${randomUUID()}` })).status);
    expect(codes.slice(0, 10).every((x) => x === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe('account deletion', () => {
  it('requires the password, deletes the account and tells its other devices', async () => {
    const acc = await registered('Deletable');
    await acc.connect();
    expect((await acc.req('DELETE', '/me', { password: 'wrong-password' })).status).toBe(403);
    expect((await acc.req('DELETE', '/me', {})).status).toBe(403);
    expect((await acc.req('DELETE', '/me', { password: 'password123' })).status).toBe(200);
    await acc.waitFor('account:deleted', (p) => p.userId === acc.userId);
    const login = await mk().req('POST', '/auth/login', { email: acc.email, password: 'password123', deviceId: 'dev-12345678' });
    expect(login.status).toBe(401);
  });

  it('a set session passes to the oldest registered member, skipping older guests', async () => {
    const owner = await (await registered('Set owner')).connect();
    const olderGuest = await (await mk().guest('Older guest')).connect();
    const heir = await (await registered('Heir')).connect();
    const { s } = await sessionWith(owner, { isSet: true }, olderGuest, heir);
    expect((await owner.req('DELETE', '/me', { password: 'password123' })).status).toBe(200);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.ownerId).toBe(heir.userId);
    expect(after.isSet).toBe(true);
  });

  it('a set session left with only guests goes to the oldest guest and becomes temporary', async () => {
    const owner = await (await registered('Set owner 2')).connect();
    const g1 = await (await mk().guest('Guest one')).connect();
    const g2 = await (await mk().guest('Guest two')).connect();
    const { s } = await sessionWith(owner, { isSet: true }, g1, g2);
    expect((await owner.req('DELETE', '/me', { password: 'password123' })).status).toBe(200);
    const after = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.ownerId).toBe(g1.userId);
    expect(after.isSet).toBe(false);
    const updated = await g2.waitFor('session:updated', (p) => p.id === s.id && p.ownerId === g1.userId);
    expect(updated.isSet).toBe(false);
  });
});

describe('security fixes', () => {
  it('voice tokens are short-lived', async () => {
    const c = await (await mk().guest('Voice')).connect();
    const { voice } = await sessionWith(c, {});
    const token = (await c.req('POST', `/channels/${voice.id}/voice-token`)).body.token as string;
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(p.exp - p.nbf).toBeLessThanOrEqual(600);
  });

  it('rejects an oversized profile image before processing it', async () => {
    const c = await mk().guest('Big avatar');
    const t = await c.req('POST', '/me/media-upload', { purpose: 'avatar', mime: 'image/png', size: 1000 });
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: t.body.attachmentId } });
    // Storage didn't enforce the declared size: 11 MB landed instead of 1 KB.
    await putObject(att.storageKey, Buffer.alloc(11 * 1024 * 1024, 1), 'image/png');
    const r = await c.req('PATCH', '/me', { avatarUploadId: att.id });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('too_large');
    expect(await headObject(att.storageKey)).toBeNull();
  });

  it('serves risky file types as downloads and never as inline media', async () => {
    const c = await (await mk().guest('Uploader')).connect();
    const { s, text } = await sessionWith(c, {});
    const ids: string[] = [];
    for (const [filename, mime, kind] of [
      ['page.html', 'text/html', 'FILE'],
      ['logo.svg', 'image/svg+xml', 'IMAGE'],
      ['photo.png', 'image/png', 'IMAGE'],
    ] as const) {
      const body = Buffer.from('<html><script>alert(1)</script></html>');
      const t = await c.req('POST', `/sessions/${s.id}/uploads`, { filename, mime, size: body.length, kind });
      expect(t.status).toBe(200);
      await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.headers, body: new Uint8Array(body) });
      ids.push(t.body.attachmentId);
    }
    const msg = (await c.req('POST', `/channels/${text.id}/messages`, { content: '', attachmentIds: ids })).body.message;
    const [html, svg, png] = msg.attachments;
    expect(html.url).toContain('response-content-disposition=attachment');
    expect(html.url).toContain('response-content-type=application%2Foctet-stream');
    expect(svg.kind).toBe('FILE');
    expect(svg.url).toContain('response-content-disposition=attachment');
    expect(png.kind).toBe('IMAGE');
    expect(png.url).toContain('response-content-disposition=inline');
    expect((await c.req('POST', `/sessions/${s.id}/uploads`, { filename: 'x', mime: 'text/html\r\nX-Evil: 1', size: 5, kind: 'FILE' })).status).toBe(400);
  });

  it('enforces the daily upload quota', async () => {
    const c = await (await mk().guest('Hoarder')).connect();
    const { s } = await sessionWith(c, {});
    const hundredMb = 100 * 1024 * 1024;
    for (let i = 0; i < 3; i++) {
      expect((await c.req('POST', `/sessions/${s.id}/uploads`, { filename: `f${i}`, mime: 'application/zip', size: hundredMb, kind: 'FILE' })).status).toBe(200);
    }
    const over = await c.req('POST', `/sessions/${s.id}/uploads`, { filename: 'f4', mime: 'application/zip', size: 1024 * 1024, kind: 'FILE' });
    expect(over.status).toBe(429);
    expect(over.body.error).toBe('quota_exceeded');
  });

  it('locks an email after 10 failed logins, even for the right password', async () => {
    const acc = await registered('Locked');
    const attacker = mk();
    for (let i = 0; i < 10; i++) {
      expect((await attacker.req('POST', '/auth/login', { email: acc.email, password: `nope-${i}`, deviceId: 'dev-12345678' })).status).toBe(401);
    }
    const r = await attacker.req('POST', '/auth/login', { email: acc.email, password: 'password123', deviceId: 'dev-12345678' });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('too_many_attempts');
  });

  it('throttles session:enter floods on a socket', async () => {
    const c = await (await mk().guest('Spammer')).connect();
    const { s } = await sessionWith(c, {}); // 1 enter used
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => c.enter(s.id)));
    const limited = results.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'rate_limited');
    expect(limited.length).toBeGreaterThan(0);
  });
});
