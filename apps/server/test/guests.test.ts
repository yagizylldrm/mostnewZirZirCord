import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/db';
import { headObject } from '../src/lib/storage';
import { cleanupInactiveGuests } from '../src/lib/guests';
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

async function sessionWith(owner: Client, ...others: Client[]) {
  const s = (await owner.req('POST', '/sessions', { name: 'Guests' })).body.session;
  const snap = await owner.enter(s.id);
  for (const o of others) {
    await o.req('POST', '/sessions/join', { code: s.code });
    await o.enter(s.id);
  }
  return { s, text: snap.channels.find((c) => c.type === 'TEXT')! };
}

async function uploadMedia(c: Client, purpose: 'avatar' | 'banner' | 'sticker') {
  const buf = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#ff8800' } }).png().toBuffer();
  const t = await c.req('POST', '/me/media-upload', { purpose, mime: 'image/png', size: buf.length });
  expect(t.status).toBe(200);
  const put = await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.headers, body: new Uint8Array(buf) });
  expect(put.status).toBe(200);
  return t.body.attachmentId as string;
}

const logout = (c: Client) => c.req('POST', '/auth/logout', { refreshToken: c.refreshToken });
const refresh = (c: Client) => c.req('POST', '/auth/refresh', { refreshToken: c.refreshToken, deviceId: c.deviceId });

describe('guest logout', () => {
  it('deletes a guest who never wrote anything', async () => {
    const g = await mk().guest('Silent');
    expect((await logout(g)).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: g.userId } })).toBeNull();
    expect((await refresh(g)).status).toBe(401);
  });

  it("keeps a guest's name and messages but closes the account", async () => {
    const owner = await (await mk().register('Owner')).connect();
    const g = await (await mk().guest('Chatty')).connect();
    const { s, text } = await sessionWith(owner, g);
    expect((await g.req('POST', `/channels/${text.id}/messages`, { content: 'hello from a guest' })).status).toBe(200);
    await prisma.user.update({ where: { id: g.userId }, data: { bio: 'about me' } });

    await g.exit(s.id);
    expect((await logout(g)).status).toBe(200);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: g.userId } });
    expect(u.displayName).toBe('Chatty');
    expect(u.deletedAt).not.toBeNull();
    expect(u.bio).toBe('');
    expect(await prisma.refreshToken.count({ where: { userId: g.userId } })).toBe(0);
    expect((await refresh(g)).status).toBe(401);

    // The message stays, and the session still knows the author's name (flagged as deleted).
    const msgs = (await owner.req('GET', `/channels/${text.id}/messages`)).body;
    const list = Array.isArray(msgs) ? msgs : msgs.messages;
    expect(list.some((x: any) => x.content === 'hello from a guest' && x.authorId === g.userId)).toBe(true);
    const newcomer = await (await mk().guest('Newcomer')).connect();
    await newcomer.req('POST', '/sessions/join', { code: s.code });
    const snap = await newcomer.enter(s.id);
    const member = snap.members.find((m) => m.user.id === g.userId);
    expect(member?.user.displayName).toBe('Chatty');
    expect(member?.user.isDeleted).toBe(true);
    expect(member?.role).toBe('MEMBER');
  });

  it("drops memberships of sessions the guest never wrote in", async () => {
    const owner = await (await mk().register('Owner2')).connect();
    const g = await (await mk().guest('Lurker')).connect();
    const a = await sessionWith(owner, g);
    const b = await sessionWith(owner, g);
    await g.req('POST', `/channels/${a.text.id}/messages`, { content: 'only here' });
    await g.exit(a.s.id);
    await g.exit(b.s.id);
    await logout(g);
    expect(await prisma.sessionMember.findUnique({ where: { sessionId_userId: { sessionId: a.s.id, userId: g.userId } } })).not.toBeNull();
    expect(await prisma.sessionMember.findUnique({ where: { sessionId_userId: { sessionId: b.s.id, userId: g.userId } } })).toBeNull();
  });

  it('hands ownership of a still-active session to another member', async () => {
    const g = await (await mk().guest('GuestOwner')).connect();
    const other = await (await mk().guest('Stays')).connect();
    const { s, text } = await sessionWith(g, other);
    await g.req('POST', `/channels/${text.id}/messages`, { content: 'bye' });

    await g.exit(s.id);
    expect((await logout(g)).status).toBe(200);

    const session = await prisma.session.findUnique({ where: { id: s.id } });
    expect(session?.ownerId).toBe(other.userId);
    const m = await prisma.sessionMember.findUniqueOrThrow({ where: { sessionId_userId: { sessionId: s.id, userId: other.userId } } });
    expect(m.role).toBe('OWNER');
  });

  it('never hands ownership to a closed guest', async () => {
    const g = await (await mk().guest('Founder')).connect();
    const ghost = await (await mk().guest('Ghost')).connect();
    const live = await (await mk().guest('Live')).connect();
    const { s, text } = await sessionWith(g, ghost, live); // ghost joined before live
    await ghost.req('POST', `/channels/${text.id}/messages`, { content: 'boo' });
    await ghost.exit(s.id);
    await logout(ghost); // closed, but its membership stays for the message

    await g.exit(s.id);
    await logout(g);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).ownerId).toBe(live.userId);
  });

  it('leaves registered accounts alone on logout', async () => {
    const r = await mk().register('Registered');
    expect((await logout(r)).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: r.userId } })).not.toBeNull();
  });
});

describe('guest logout side effects', () => {
  it('removes the guest\'s avatar, banner and sticker files from storage', async () => {
    const g = await mk().guest('Pictures');
    const me = await g.req('PATCH', '/me', { avatarUploadId: await uploadMedia(g, 'avatar'), bannerUploadId: await uploadMedia(g, 'banner') });
    expect(me.status).toBe(200);
    expect((await g.req('POST', '/me/stickers', { uploadId: await uploadMedia(g, 'sticker') })).status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: g.userId }, include: { stickers: true } });
    const keys = [u.avatarKey, u.bannerKey, ...u.stickers.map((s) => s.storageKey)].filter((k): k is string => !!k);
    expect(keys).toHaveLength(3);
    for (const k of keys) expect(await headObject(k)).not.toBeNull();

    await logout(g);
    for (const k of keys) expect(await headObject(k)).toBeNull();
  });

  it('tells people in the session right away (name kept → flagged, nothing written → removed)', async () => {
    const owner = await (await mk().register('Watcher')).connect();
    const writer = await (await mk().guest('Writer')).connect();
    const quiet = await (await mk().guest('Quiet')).connect();
    const { s, text } = await sessionWith(owner, writer, quiet);
    await writer.req('POST', `/channels/${text.id}/messages`, { content: 'still here after logout' });
    owner.clearEvents();

    await writer.exit(s.id);
    await logout(writer);
    const up = await owner.waitFor('member:upsert', (p) => p.sessionId === s.id && p.member.user.id === writer.userId && p.member.user.isDeleted);
    expect(up.member.user.displayName).toBe('Writer');

    await quiet.exit(s.id);
    await logout(quiet);
    await owner.waitFor('member:removed', (p) => p.sessionId === s.id && p.userId === quiet.userId);
  });

  it('disconnects the guest\'s other open connections', async () => {
    const g = await (await mk().guest('TwoTabs')).connect();
    const disconnected = new Promise<void>((res) => g.socket!.once('disconnect', () => res()));
    await logout(g);
    await disconnected;
  });
});

describe('inactive guest cleanup', () => {
  it('never closes a guest that is connected right now', async () => {
    const day = 24 * 60 * 60 * 1000;
    const g = await (await mk().guest('LongTab')).connect();
    await sleep(100); // let the connect-time lastSeenAt update land first
    await prisma.user.update({ where: { id: g.userId }, data: { lastSeenAt: new Date(Date.now() - 40 * day) } });
    await cleanupInactiveGuests(app);
    const u = await prisma.user.findUnique({ where: { id: g.userId } });
    expect(u).not.toBeNull();
    expect(u!.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - day);
  });

  it('closes guests not seen for 30 days and keeps everyone else', async () => {
    const day = 24 * 60 * 60 * 1000;
    const stale = await mk().guest('Stale');
    const fresh = await mk().guest('Fresh');
    const oldAccount = await mk().register('OldAccount');
    await prisma.user.update({ where: { id: stale.userId }, data: { lastSeenAt: new Date(Date.now() - 31 * day) } });
    await prisma.user.update({ where: { id: fresh.userId }, data: { lastSeenAt: new Date(Date.now() - 1 * day) } });
    await prisma.user.update({ where: { id: oldAccount.userId }, data: { lastSeenAt: new Date(Date.now() - 90 * day) } });

    await cleanupInactiveGuests(app);
    await sleep(50);

    expect(await prisma.user.findUnique({ where: { id: stale.userId } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: fresh.userId } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: oldAccount.userId } })).not.toBeNull();
  });
});
