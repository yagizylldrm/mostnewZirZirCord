import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/db';
import { headObject } from '../src/lib/storage';
import { Client, sleep, startServer } from './helpers';

let app: FastifyInstance;
let base: string;
const clients: Client[] = [];
const mk = (deviceId?: string) => {
  const c = new Client(base, deviceId);
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

async function createSession(owner: Client, body: Record<string, unknown> = {}) {
  const r = await owner.req('POST', '/sessions', { name: 'Test session', ...body });
  expect(r.status).toBe(200);
  return r.body.session as { id: string; code: string };
}

describe('session lifecycle', () => {
  it('passes host to the next oldest member and deletes a temporary session when everyone leaves', async () => {
    const a = await (await mk().guest('Alice')).connect();
    const b = await (await mk().guest('Bob')).connect();
    const c = await (await mk().guest('Cem')).connect();
    const s = await createSession(a);

    const snapA = await a.enter(s.id);
    expect(snapA.presence.hostId).toBe(a.userId);
    expect(snapA.myRole).toBe('OWNER');
    expect(snapA.channels.map((ch) => ch.type).sort()).toEqual(['TEXT', 'VOICE']);

    // join with a sloppy-formatted code
    const sloppy = `${s.code.slice(0, 4).toLowerCase()} - ${s.code.slice(4)}`;
    expect((await b.req('POST', '/sessions/join', { code: sloppy })).status).toBe(200);
    await sleep(5);
    await b.enter(s.id);
    expect((await c.req('POST', '/sessions/join', { code: s.code })).status).toBe(200);
    const snapC = await c.enter(s.id);
    expect(snapC.presence.present.map((p) => p.userId)).toEqual([a.userId, b.userId, c.userId]);
    // members never see each other's private data
    expect(JSON.stringify(snapC.members)).not.toContain('@');

    b.clearEvents();
    await a.exit(s.id);
    const p = await b.waitFor('presence:update', (x) => x.hostId === b.userId);
    expect(p.present).toHaveLength(2);

    // Owner left, but session stays alive and the owner keeps the owner role.
    const again = await a.enter(s.id);
    expect(again.myRole).toBe('OWNER');
    expect(again.presence.hostId).toBe(b.userId); // a rejoined → now the newest
    await a.exit(s.id);

    // Upload a file so we can verify it gets deleted with the session.
    const ticket = await b.req('POST', `/sessions/${s.id}/uploads`, { filename: 'hi.txt', mime: 'text/plain', size: 5, kind: 'FILE' });
    expect(ticket.status).toBe(200);
    const put = await fetch(ticket.body.uploadUrl, { method: 'PUT', headers: ticket.body.headers, body: 'hello' });
    expect(put.status).toBe(200);
    const general = snapC.channels.find((ch) => ch.type === 'TEXT')!;
    const sent = await b.req('POST', `/channels/${general.id}/messages`, { content: 'file!', attachmentIds: [ticket.body.attachmentId] });
    expect(sent.status).toBe(200);
    const key = (await prisma.attachment.findUniqueOrThrow({ where: { id: ticket.body.attachmentId } })).storageKey;
    expect(await headObject(key)).not.toBeNull();
    const fetched = await (await fetch(sent.body.message.attachments[0].url)).text();
    expect(fetched).toBe('hello');

    await c.exit(s.id);
    c.clearEvents();
    await b.exit(s.id);
    await sleep(300);
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
    expect(await prisma.message.count({ where: { channelId: general.id } })).toBe(0);
    expect(await headObject(key)).toBeNull();
    expect((await b.req('POST', '/sessions/join', { code: s.code })).status).toBe(404);
  });

  it('keeps presence through a short disconnect but drops it after the grace period', async () => {
    const a = await (await mk().guest('Ana')).connect();
    const b = await (await mk().guest('Ben')).connect();
    const s = await createSession(a);
    await a.enter(s.id);
    await b.req('POST', '/sessions/join', { code: s.code });
    await b.enter(s.id);

    a.clearEvents();
    b.close();
    await sleep(300);
    expect((await app.hub.getPresence(s.id)).present).toHaveLength(2);
    await a.waitFor('presence:update', (p) => p.present.length === 1, 4000);
    await a.exit(s.id);
  });

  it('closes a session nobody ever entered', async () => {
    const a = await mk().guest('Lonely');
    const s = await createSession(a);
    await sleep(6500);
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull();
  });
});

describe('set sessions', () => {
  it('goes dormant when empty, appears for past visitors, and the opener becomes host', async () => {
    const guestOwner = await mk().guest('Guesty');
    expect((await guestOwner.req('POST', '/sessions', { name: 'x', isSet: true })).status).toBe(403);

    const owner = await (await mk().register('Owner')).connect();
    const visitor = await (await mk().guest('Visitor')).connect();
    const s = await createSession(owner, { isSet: true });
    await owner.enter(s.id);
    await visitor.req('POST', '/sessions/join', { code: s.code });
    await visitor.enter(s.id);
    await owner.exit(s.id);
    await visitor.exit(s.id);
    await sleep(200);

    const row = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.state).toBe('DORMANT');
    const list = await visitor.req('GET', '/me/sessions');
    const item = list.body.setSessions.find((x: any) => x.session.id === s.id);
    expect(item).toBeTruthy();
    expect(item.live).toBe(false);

    const snap = await visitor.enter(s.id);
    expect(snap.session.state).toBe('ACTIVE');
    expect(snap.presence.hostId).toBe(visitor.userId);
    expect(snap.myRole).toBe('MEMBER');
    await owner.enter(s.id);
    await visitor.exit(s.id);
    await owner.exit(s.id);
  });
});

describe('moderation and permissions', () => {
  it('bans by user and by device, and unbans', async () => {
    const owner = await (await mk().guest('Boss')).connect();
    const sharedDevice = `dev-shared-${Date.now()}`;
    const troll = await (await mk(sharedDevice).guest('Troll')).connect();
    const s = await createSession(owner);
    await owner.enter(s.id);
    await troll.req('POST', '/sessions/join', { code: s.code });
    await troll.enter(s.id);

    expect((await troll.req('POST', `/sessions/${s.id}/bans`, { userId: owner.userId })).status).toBe(403);
    expect((await owner.req('POST', `/sessions/${s.id}/bans`, { userId: troll.userId, reason: 'spam' })).status).toBe(200);
    await troll.waitFor('session:removed', (p) => p.reason === 'banned');
    expect((await app.hub.getPresence(s.id)).present.map((p) => p.userId)).toEqual([owner.userId]);
    expect((await troll.req('POST', '/sessions/join', { code: s.code })).body.error).toBe('banned');

    // New guest identity on the same device is still banned.
    const alt = await mk(sharedDevice).guest('NotTroll');
    expect((await alt.req('POST', '/sessions/join', { code: s.code })).body.error).toBe('banned');

    const bans = await owner.req('GET', `/sessions/${s.id}/bans`);
    expect(bans.body.bans[0].user.publicId).toBe(troll.publicId);
    expect((await owner.req('DELETE', `/sessions/${s.id}/bans/${troll.userId}`)).status).toBe(200);
    expect((await troll.req('POST', '/sessions/join', { code: s.code })).status).toBe(200);
    await owner.exit(s.id);
  });

  it('enforces channel-creation settings, mods by public id, and channel bans', async () => {
    const owner = await (await mk().guest('Own')).connect();
    const mod = await (await mk().guest('Mod')).connect();
    const member = await (await mk().guest('Mem')).connect();
    const s = await createSession(owner);
    const snap = await owner.enter(s.id);
    for (const c of [mod, member]) {
      await c.req('POST', '/sessions/join', { code: s.code });
      await c.enter(s.id);
    }

    expect((await member.req('PATCH', `/sessions/${s.id}`, { membersCanCreateVoice: false })).status).toBe(403);
    expect((await owner.req('PATCH', `/sessions/${s.id}`, { membersCanCreateVoice: false })).status).toBe(200);
    expect((await member.req('POST', `/sessions/${s.id}/channels`, { name: 'loud', type: 'VOICE' })).body.error).toBe(
      'channel_creation_disabled',
    );
    expect((await member.req('POST', `/sessions/${s.id}/channels`, { name: 'Memes Here', type: 'TEXT' })).body.channel.name).toBe(
      'memes-here',
    );

    expect((await mod.req('POST', `/sessions/${s.id}/mods`, { publicId: member.publicId })).status).toBe(403);
    expect((await owner.req('POST', `/sessions/${s.id}/mods`, { publicId: mod.publicId.toLowerCase() })).status).toBe(200);
    expect((await mod.req('POST', `/sessions/${s.id}/channels`, { name: 'mods-voice', type: 'VOICE' })).status).toBe(200);
    expect((await mod.req('POST', `/sessions/${s.id}/kick/${owner.userId}`)).status).toBe(403);

    const text = snap.channels.find((c) => c.type === 'TEXT')!;
    expect((await mod.req('POST', `/channels/${text.id}/bans/${member.userId}`, {})).status).toBe(200);
    await member.waitFor('channel:removed', (p) => p.channelId === text.id);
    expect((await member.req('GET', `/channels/${text.id}/messages`)).body.error).toBe('channel_banned');
    member.clearEvents();
    await owner.req('POST', `/channels/${text.id}/messages`, { content: 'secret' });
    await sleep(200);
    expect(member.events.some(([e]) => e === 'message:new')).toBe(false);

    expect((await mod.req('DELETE', `/channels/${text.id}/bans/${member.userId}`)).status).toBe(200);
    await owner.req('POST', `/channels/${text.id}/messages`, { content: 'welcome back' });
    await member.waitFor('message:new', (m) => m.content === 'welcome back');

    // kick: removed from presence but can come back
    expect((await owner.req('POST', `/sessions/${s.id}/kick/${member.userId}`)).status).toBe(200);
    await member.waitFor('session:removed', (p) => p.reason === 'kicked');
    expect(await app.hub.isPresent(s.id, member.userId)).toBe(false);
    await member.enter(s.id);

    // ownership transfer
    expect((await owner.req('POST', `/sessions/${s.id}/transfer`, { publicId: mod.publicId })).status).toBe(200);
    expect((await owner.req('POST', `/sessions/${s.id}/rotate-code`)).status).toBe(403);
    expect((await mod.req('POST', `/sessions/${s.id}/rotate-code`)).status).toBe(200);
    for (const c of [owner, mod, member]) await c.exit(s.id);
  });

  it('voice tokens require presence', async () => {
    const owner = await (await mk().guest('Vo')).connect();
    const s = await createSession(owner);
    const snap = await owner.enter(s.id);
    const voice = snap.channels.find((c) => c.type === 'VOICE')!;
    const r = await owner.req('POST', `/channels/${voice.id}/voice-token`);
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    await owner.exit(s.id);
  });
});

describe('accounts', () => {
  it('upgrading a guest keeps the same public id; refresh rotates tokens', async () => {
    const g = await mk().guest('Upgrader');
    const r = await g.req('POST', '/auth/upgrade', { email: `up-${Date.now()}@t.local`, password: 'password123' });
    expect(r.status).toBe(200);
    expect(r.body.user.publicId).toBe(g.publicId);
    expect(r.body.user.isGuest).toBe(false);

    const refreshed = await g.req('POST', '/auth/refresh', { refreshToken: g.refreshToken, deviceId: g.deviceId });
    expect(refreshed.status).toBe(200);
    const reuse = await g.req('POST', '/auth/refresh', { refreshToken: g.refreshToken, deviceId: g.deviceId });
    expect(reuse.status).toBe(401);
  });
});
