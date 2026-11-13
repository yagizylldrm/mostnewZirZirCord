import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { io as ioc } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SPAM } from '@zirzircord/shared';
import { prisma } from '../src/lib/db';
import { headObject } from '../src/lib/storage';
import { clearAccessCache } from '../src/sessions/access';
import { sweepSleepingSessions } from '../src/sessions/sleep';
import { Client, startServer } from './helpers';

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

async function sessionWith(owner: Client, body: Record<string, unknown>, ...others: Client[]) {
  const s = (await owner.req('POST', '/sessions', { name: 'Batch4', ...body })).body.session;
  const snap = await owner.enter(s.id);
  for (const o of others) {
    await o.req('POST', '/sessions/join', { code: s.code });
    await o.enter(s.id);
  }
  return { s, text: snap.channels.find((c) => c.type === 'TEXT')! };
}

const send = (c: Client, channelId: string, content: string) => c.req('POST', `/channels/${channelId}/messages`, { content });
const DAY = 24 * 60 * 60 * 1000;

describe('spam protection', () => {
  it('times out a user who sends too fast, escalating 1 min → 5 min', async () => {
    const u = await (await mk().guest('Spammer')).connect();
    const watcher = await (await mk().guest('Watcher')).connect();
    const { s, text } = await sessionWith(u, {}, watcher);

    for (let i = 0; i < SPAM.sessionMax; i++) expect((await send(u, text.id, `m${i}`)).status).toBe(200);
    const blocked = await send(u, text.id, 'one too many');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('timed_out');
    const until = new Date(blocked.body.until).getTime() - Date.now();
    expect(until).toBeGreaterThan(50_000);
    expect(until).toBeLessThanOrEqual(60_000);
    // The session sees the timeout, and the user can't send, edit or react meanwhile — but can read.
    const up = await watcher.waitFor('member:upsert', (p) => p.member.user.id === u.userId && p.member.timeoutUntil);
    expect(up.member.timeoutUntil).toBeTruthy();
    expect((await send(u, text.id, 'still here?')).body.error).toBe('timed_out');
    const mine = (await u.req('GET', `/channels/${text.id}/messages`)).body.messages[0];
    expect((await u.req('PATCH', `/messages/${mine.id}`, { content: 'edited' })).body.error).toBe('timed_out');
    expect((await u.req('PUT', `/messages/${mine.id}/reactions/${encodeURIComponent('👍')}`)).body.error).toBe('timed_out');
    expect((await u.req('GET', `/channels/${text.id}/messages`)).status).toBe(200);
    await u.exit(s.id);
  });

  it('second strike within the hour lasts 5 minutes', async () => {
    const u = await (await mk().guest('Repeat spammer')).connect();
    const { s, text } = await sessionWith(u, {});
    for (let i = 0; i <= SPAM.sessionMax; i++) await send(u, text.id, `a${i}`);
    // The first timeout runs out (strikes are remembered for an hour).
    await prisma.sessionMember.update({ where: { sessionId_userId: { sessionId: s.id, userId: u.userId } }, data: { timeoutUntil: null } });
    clearAccessCache(); // access checks are cached for a few seconds
    let last: { status: number; body: any } | null = null;
    for (let i = 0; i <= SPAM.sessionMax; i++) last = await send(u, text.id, `b${i}`);
    expect(last!.status).toBe(429);
    const ms = new Date(last!.body.until).getTime() - Date.now();
    expect(ms).toBeGreaterThan(4 * 60_000);
    expect(ms).toBeLessThanOrEqual(5 * 60_000);
  });

  it('moderators can time members out (not the owner), and remove it again', async () => {
    const owner = await (await mk().register('Owner')).connect();
    const mod = await (await mk().register('Mod')).connect();
    const member = await (await mk().guest('Member')).connect();
    const { s, text } = await sessionWith(owner, {}, mod, member);
    expect((await owner.req('POST', `/sessions/${s.id}/mods`, { publicId: mod.publicId })).status).toBe(200);

    expect((await member.req('POST', `/sessions/${s.id}/members/${mod.userId}/timeout`, { minutes: 10 })).status).toBe(403);
    expect((await mod.req('POST', `/sessions/${s.id}/members/${owner.userId}/timeout`, { minutes: 10 })).status).toBe(403);
    expect((await mod.req('POST', `/sessions/${s.id}/members/${member.userId}/timeout`, { minutes: 7 })).status).toBe(400);

    const r = await mod.req('POST', `/sessions/${s.id}/members/${member.userId}/timeout`, { minutes: 10 });
    expect(r.status).toBe(200);
    expect(new Date(r.body.member.timeoutUntil).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    expect((await send(member, text.id, 'hi')).body.error).toBe('timed_out');
    expect((await member.req('POST', `/sessions/${s.id}/uploads`, { filename: 'a.txt', mime: 'text/plain', size: 5, kind: 'FILE' })).body.error).toBe('timed_out');

    expect((await mod.req('POST', `/sessions/${s.id}/members/${member.userId}/timeout`, { minutes: null })).body.member.timeoutUntil).toBeNull();
    expect((await send(member, text.id, 'free again')).status).toBe(200);
  });
});

describe('app-only access', () => {
  const raw = (path: string, headers: Record<string, string>) =>
    fetch(base + path, { headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.1`, ...headers } });

  it('refuses other websites and requests without the app header', async () => {
    const r1 = await raw('/me', { origin: 'https://evil.example', 'x-zz-client': 'web/1' });
    expect(r1.status).toBe(403);
    expect((await r1.json()).error).toBe('bad_origin');
    const r2 = await raw('/me', {});
    expect(r2.status).toBe(403);
    expect((await r2.json()).error).toBe('app_required');
    const r3 = await raw('/me', { 'x-zz-client': 'curl/8' });
    expect((await r3.json()).error).toBe('app_required');
    // Look-alike Vercel projects don't match exact / label patterns.
    const r4 = await raw('/me', { origin: 'http://localhost:5173.evil.example', 'x-zz-client': 'web/1' });
    expect((await r4.json()).error).toBe('bad_origin');
  });

  it('lets the apps through, plus health, images and the LiveKit webhook', async () => {
    expect((await raw('/me', { 'x-zz-client': 'mobile/0.1.0' })).status).toBe(401); // reached auth
    expect((await raw('/me', { origin: 'http://localhost:5173', 'x-zz-client': 'web/0.1.0' })).status).toBe(401);
    expect((await raw('/me', { origin: 'http://localhost:5173' })).status).toBe(401); // already-deployed website builds
    expect((await (await raw('/me', { origin: 'null' })).json()).error).toBe('app_required'); // Electron without the header
    expect((await raw('/me', { origin: 'null', 'x-zz-client': 'desktop/0.1.0' })).status).toBe(401);
    expect((await raw('/health', {})).status).toBe(200);
    expect((await raw(`/users/${randomUUID()}/avatar`, {})).status).toBe(404);
    expect((await raw(`/sessions/${randomUUID()}/icon`, {})).status).toBe(404);
    const hook = await fetch(base + '/webhooks/livekit', { method: 'POST', headers: { 'content-type': 'application/webhook+json' }, body: '{}' });
    expect(hook.status).not.toBe(403);
  });

  it('rejects sockets without the app identity or from another website', async () => {
    const u = await mk().guest('Socket');
    const tryConnect = (opts: Parameters<typeof ioc>[1]) =>
      new Promise<string>((res) => {
        const s = ioc(base, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
        s.once('connect', () => (s.disconnect(), res('ok')));
        s.once('connect_error', (e) => (s.disconnect(), res(e.message)));
      });
    expect(await tryConnect({ auth: { token: u.token } })).toBe('app_required');
    expect(await tryConnect({ auth: { token: u.token, client: 'web/1' }, extraHeaders: { origin: 'https://evil.example' } })).not.toBe('ok');
    expect(await tryConnect({ auth: { token: u.token, client: 'mobile/1' } })).toBe('ok');
  });
});

describe('reactions', () => {
  it('adds, counts, broadcasts and removes reactions', async () => {
    const a = await (await mk().guest('Reactor A')).connect();
    const b = await (await mk().guest('Reactor B')).connect();
    const { text } = await sessionWith(a, {}, b);
    const msg = (await send(a, text.id, 'react to me')).body.message;
    expect(msg.reactions).toEqual([]);
    const thumbs = encodeURIComponent('👍');

    expect((await a.req('PUT', `/messages/${msg.id}/reactions/${thumbs}`)).status).toBe(200);
    expect((await a.req('PUT', `/messages/${msg.id}/reactions/${thumbs}`)).status).toBe(200); // idempotent
    const r = await b.req('PUT', `/messages/${msg.id}/reactions/${thumbs}`);
    expect(r.body.reactions).toEqual([{ emoji: '👍', userIds: [a.userId, b.userId] }]);
    const live = await a.waitFor('reaction:update', (p) => p.messageId === msg.id && p.reactions[0]?.userIds.length === 2);
    expect(live.channelId).toBe(text.id);

    expect((await b.req('PUT', `/messages/${msg.id}/reactions/${encodeURIComponent('🇹🇷')}`)).status).toBe(200);
    expect((await b.req('PUT', `/messages/${msg.id}/reactions/lol`)).status).toBe(400);

    const history = (await b.req('GET', `/channels/${text.id}/messages`)).body.messages;
    expect(history.find((m: any) => m.id === msg.id).reactions.map((x: any) => x.emoji)).toEqual(['👍', '🇹🇷']);

    const del = await a.req('DELETE', `/messages/${msg.id}/reactions/${thumbs}`);
    expect(del.body.reactions[0]).toEqual({ emoji: '👍', userIds: [b.userId] });

    // Outsiders can't react.
    const outsider = await mk().guest('Outsider');
    expect((await outsider.req('PUT', `/messages/${msg.id}/reactions/${thumbs}`)).status).toBe(404);

    // Deleting the message deletes its reactions.
    await a.req('DELETE', `/messages/${msg.id}`);
    expect(await prisma.reaction.count({ where: { messageId: msg.id } })).toBe(0);
  });

  it('limits a message to 20 different emojis', async () => {
    const a = await (await mk().guest('Collector')).connect();
    const { text } = await sessionWith(a, {});
    const msg = (await send(a, text.id, 'many')).body.message;
    const emojis = [...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙🥲😚🙂🤗'];
    await prisma.reaction.createMany({ data: emojis.slice(0, 20).map((emoji) => ({ messageId: msg.id, userId: a.userId, emoji })) });
    const r = await a.req('PUT', `/messages/${msg.id}/reactions/${encodeURIComponent(emojis[20])}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('too_many_reactions');
    // An existing emoji can still be added by someone else.
    expect((await a.req('PUT', `/messages/${msg.id}/reactions/${encodeURIComponent(emojis[0])}`)).status).toBe(200);
  });
});

describe('session pictures', () => {
  async function iconUpload(c: Client) {
    const buf = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#aa3333' } }).png().toBuffer();
    const t = await c.req('POST', '/me/media-upload', { purpose: 'sessionIcon', mime: 'image/png', size: buf.length });
    await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.headers, body: new Uint8Array(buf) });
    return t.body.attachmentId as string;
  }

  it('owner sets a picture on a set session; members cannot; temporary sessions refuse', async () => {
    const owner = await (await mk().register('Picture owner')).connect();
    const member = await (await mk().guest('Picture member')).connect();
    const { s } = await sessionWith(owner, { isSet: true }, member);

    expect((await member.req('PATCH', `/sessions/${s.id}`, { iconUploadId: await iconUpload(member) })).status).toBe(403);

    const r = await owner.req('PATCH', `/sessions/${s.id}`, { iconUploadId: await iconUpload(owner) });
    expect(r.status).toBe(200);
    expect(r.body.session.iconUrl).toMatch(new RegExp(`/sessions/${s.id}/icon\\?v=`));
    const live = await member.waitFor('session:updated', (p) => p.id === s.id && p.iconUrl);
    expect(live.iconUrl).toBe(r.body.session.iconUrl);
    const u = new URL(r.body.session.iconUrl);
    const redirect = await fetch(base + u.pathname + u.search, { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    const img = await sharp(Buffer.from(await (await fetch(redirect.headers.get('location')!)).arrayBuffer())).metadata();
    expect([img.format, img.width, img.height]).toEqual(['webp', 256, 256]);

    // Replacing removes the old file; deleting the session removes the new one.
    const firstKey = (await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).iconKey!;
    await owner.req('PATCH', `/sessions/${s.id}`, { iconUploadId: await iconUpload(owner) });
    const secondKey = (await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).iconKey!;
    expect(await headObject(firstKey)).toBeNull();
    expect(await headObject(secondKey)).not.toBeNull();
    await owner.req('DELETE', `/sessions/${s.id}`);
    expect(await headObject(secondKey)).toBeNull();

    const temp = (await sessionWith(owner, {})).s;
    const t = await owner.req('PATCH', `/sessions/${temp.id}`, { iconUploadId: await iconUpload(owner) });
    expect(t.status).toBe(400);
    expect(t.body.error).toBe('set_only');
  });
});

describe('sleeping set sessions', () => {
  it('falls asleep after 5 idle days, wakes when opened, and is deleted after 30 days asleep', async () => {
    const owner = await (await mk().register('Sleepy owner')).connect();
    const { s } = await sessionWith(owner, { isSet: true });
    const temp = (await sessionWith(owner, {})).s;
    await owner.exit(s.id);

    // Someone present keeps a session awake.
    await prisma.session.update({ where: { id: temp.id }, data: { lastActiveAt: new Date(Date.now() - 6 * DAY) } });
    await prisma.session.update({ where: { id: s.id }, data: { lastActiveAt: new Date(Date.now() - 6 * DAY) } });
    await sweepSleepingSessions(app);
    const asleep = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(asleep.sleepingSince).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: temp.id } })).sleepingSince).toBeNull(); // temporary: never sleeps

    const listed = (await owner.req('GET', '/me/sessions')).body.setSessions.find((x: any) => x.session.id === s.id);
    expect(listed.session.sleepingSince).toBeTruthy();

    // Opening wakes it.
    const snap = await owner.enter(s.id);
    expect(snap.session.sleepingSince).toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).sleepingSince).toBeNull();

    // While someone is in it, it doesn't fall asleep.
    await prisma.session.update({ where: { id: s.id }, data: { lastActiveAt: new Date(Date.now() - 6 * DAY) } });
    await sweepSleepingSessions(app);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).sleepingSince).toBeNull();

    // Asleep for 31 days → deleted, members told why.
    await owner.exit(s.id);
    await prisma.session.update({ where: { id: s.id }, data: { sleepingSince: new Date(Date.now() - 31 * DAY) } });
    const r = await sweepSleepingSessions(app);
    expect(r.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });

  it('broadcasts the expired reason to anyone watching', async () => {
    const owner = await (await mk().register('Watcher owner')).connect();
    const { s } = await sessionWith(owner, { isSet: true });
    owner.clearEvents();
    // Simulate a long sleep while the owner's client still has the room joined (e.g. stale tab).
    await prisma.session.update({ where: { id: s.id }, data: { sleepingSince: new Date(Date.now() - 31 * DAY) } });
    await app.hub.deleteSession(s.id, 'expired');
    const closed = await owner.waitFor('session:closed', (p) => p.sessionId === s.id);
    expect(closed.reason).toBe('expired');
  });
});
