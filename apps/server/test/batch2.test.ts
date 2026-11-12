import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/db';
import { headObject } from '../src/lib/storage';
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
  const s = (await owner.req('POST', '/sessions', { name: 'Batch2' })).body.session;
  const snap = await owner.enter(s.id);
  for (const o of others) {
    await o.req('POST', '/sessions/join', { code: s.code });
    await o.enter(s.id);
  }
  return { s, snap, text: snap.channels.find((c) => c.type === 'TEXT')!, voice: snap.channels.find((c) => c.type === 'VOICE')! };
}

function grants(token: string) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return (payload.video?.canPublishSources ?? []).map((x: unknown) => String(x).toLowerCase());
}

/** Two-frame animated GIF made with sharp. */
async function animatedGif() {
  const red = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const blue = await sharp({ create: { width: 40, height: 40, channels: 4, background: '#0000ff' } }).png().toBuffer();
  return sharp([red, blue], { join: { animated: true } }).gif({ delay: [100, 100] }).toBuffer();
}

async function uploadMedia(c: Client, purpose: 'avatar' | 'banner' | 'sticker', buf: Buffer, mime = 'image/gif') {
  const t = await c.req('POST', '/me/media-upload', { purpose, mime, size: buf.length });
  expect(t.status).toBe(200);
  const put = await fetch(t.body.uploadUrl, { method: 'PUT', headers: t.body.headers, body: new Uint8Array(buf) });
  expect(put.status).toBe(200);
  return t.body.attachmentId as string;
}

describe('server mute (push-to-talk bypass fix)', () => {
  it('removes the microphone from voice grants until unmuted, session-wide and across rejoin', async () => {
    const owner = await (await mk().guest('Owner')).connect();
    const mod = await (await mk().guest('Mod')).connect();
    const member = await (await mk().guest('Member')).connect();
    const { s, voice } = await sessionWith(owner, mod, member);
    await owner.req('POST', `/sessions/${s.id}/mods`, { publicId: mod.publicId });

    expect(grants((await member.req('POST', `/channels/${voice.id}/voice-token`)).body.token)).toContain('microphone');
    expect((await member.req('POST', `/sessions/${s.id}/server-mute/${mod.userId}`, { muted: true })).status).toBe(403);
    expect((await mod.req('POST', `/sessions/${s.id}/server-mute/${owner.userId}`, { muted: true })).status).toBe(403);

    expect((await mod.req('POST', `/sessions/${s.id}/server-mute/${member.userId}`, { muted: true })).status).toBe(200);
    const upsert = await owner.waitFor('member:upsert', (p) => p.member.user.id === member.userId && p.member.serverMuted);
    expect(upsert.member.serverMuted).toBe(true);
    const muted = grants((await member.req('POST', `/channels/${voice.id}/voice-token`)).body.token);
    expect(muted).not.toContain('microphone');
    expect(muted).toContain('screen_share');

    // Leaving and coming back doesn't clear it.
    await member.exit(s.id);
    const snap = await member.enter(s.id);
    expect(snap.members.find((m) => m.user.id === member.userId)?.serverMuted).toBe(true);
    expect(grants((await member.req('POST', `/channels/${voice.id}/voice-token`)).body.token)).not.toContain('microphone');

    await owner.req('POST', `/sessions/${s.id}/server-mute/${member.userId}`, { muted: false });
    expect(grants((await member.req('POST', `/channels/${voice.id}/voice-token`)).body.token)).toContain('microphone');
    for (const c of [owner, mod, member]) await c.exit(s.id);
  });
});

describe('mentions', () => {
  it('keeps member mentions, drops outsiders, and gates @everyone by the owner setting', async () => {
    const owner = await (await mk().guest('Own')).connect();
    const member = await (await mk().guest('Mem')).connect();
    const outsider = await mk().guest('Out');
    const { s, text } = await sessionWith(owner, member);

    const m1 = (await member.req('POST', `/channels/${text.id}/messages`, { content: `hey <@${owner.userId}> <@${outsider.userId}> @everyone` })).body.message;
    expect(m1.mentions).toEqual([owner.userId]);
    expect(m1.mentionsEveryone).toBe(false);
    expect(m1.content).toContain('@​everyone');

    const m2 = (await owner.req('POST', `/channels/${text.id}/messages`, { content: '@everyone meeting!' })).body.message;
    expect(m2.mentionsEveryone).toBe(true);

    expect((await owner.req('PATCH', `/sessions/${s.id}`, { membersCanMentionEveryone: true })).status).toBe(200);
    const m3 = (await member.req('POST', `/channels/${text.id}/messages`, { content: '@everyone hi' })).body.message;
    expect(m3.mentionsEveryone).toBe(true);
    for (const c of [owner, member]) await c.exit(s.id);
  });
});

describe('notification settings', () => {
  it('round-trips session level/mute and channel mutes through the snapshot', async () => {
    const u = await (await mk().guest('Notif')).connect();
    const { s, snap, text } = await sessionWith(u);
    expect(snap.notify).toEqual({ level: 'ALL', mutedUntil: null });
    const until = new Date(Date.now() + 3600_000).toISOString();
    expect((await u.req('PATCH', `/sessions/${s.id}/notifications`, { level: 'ALL', mutedUntil: until })).status).toBe(200);
    expect((await u.req('PUT', `/channels/${text.id}/mute`, { mutedUntil: null })).status).toBe(200);
    const again = await u.enter(s.id);
    expect(again.notify.level).toBe('ALL');
    expect(again.notify.mutedUntil).toBe(until);
    expect(again.channelMutes).toEqual({ [text.id]: null });
    await u.req('DELETE', `/channels/${text.id}/mute`);
    expect((await u.enter(s.id)).channelMutes).toEqual({});
    await u.exit(s.id);
  });
});

describe('stickers and animated profile media', () => {
  it('makes animated stickers, sends them, lets others save them, and keeps them after the session closes', async () => {
    const a = await (await mk().guest('StickA')).connect();
    const b = await (await mk().guest('StickB')).connect();
    const gif = await animatedGif();
    const created = await a.req('POST', '/me/stickers', { uploadId: await uploadMedia(a, 'sticker', gif) });
    expect(created.status).toBe(200);
    expect(created.body.sticker.animated).toBe(true);
    expect(created.body.sticker.staticUrl).toBeTruthy();
    const fetched = Buffer.from(await (await fetch(created.body.sticker.url)).arrayBuffer());
    expect((await sharp(fetched, { animated: true }).metadata()).pages).toBe(2);

    const { s, text } = await sessionWith(a, b);
    const sent = await a.req('POST', `/channels/${text.id}/messages`, { stickerId: created.body.sticker.id });
    expect(sent.status).toBe(200);
    const att = sent.body.message.attachments[0];
    expect(att.kind).toBe('STICKER');
    expect(att.thumbnailUrl).toBeTruthy();

    expect((await b.req('POST', `/channels/${text.id}/messages`, { stickerId: created.body.sticker.id })).status).toBe(400); // not B's
    const saved = await b.req('POST', '/me/stickers/from-attachment', { attachmentId: att.id });
    expect(saved.status).toBe(200);
    expect((await b.req('GET', '/me/stickers')).body.stickers).toHaveLength(1);

    const own = await prisma.sticker.findUniqueOrThrow({ where: { id: created.body.sticker.id } });
    const copyKey = (await prisma.attachment.findUniqueOrThrow({ where: { id: att.id } })).storageKey;
    await a.exit(s.id);
    await b.exit(s.id);
    await sleep(300);
    expect(await headObject(copyKey)).toBeNull(); // session copy deleted with the session
    expect(await headObject(own.storageKey)).not.toBeNull(); // personal sticker kept

    expect((await a.req('DELETE', `/me/stickers/${own.id}`)).status).toBe(200);
    expect(await headObject(own.storageKey)).toBeNull();
  });

  it('stores animated avatars and banners with a still frame, and cleans up old files', async () => {
    const u = await mk().guest('Gifster');
    const gif = await animatedGif();
    const r1 = await u.req('PATCH', '/me', { avatarUploadId: await uploadMedia(u, 'avatar', gif), bannerUploadId: await uploadMedia(u, 'banner', gif) });
    expect(r1.status).toBe(200);
    const user1 = r1.body.user;
    expect(user1.avatarUrl).not.toBe(user1.avatarStaticUrl);
    expect(user1.avatarStaticUrl).toContain('static=1');
    expect(user1.bannerUrl).toBeTruthy();
    const row1 = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });

    const u1 = new URL(user1.avatarStaticUrl);
    const res = await fetch(base + u1.pathname + u1.search, { redirect: 'manual' });
    expect(res.status).toBe(302);

    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#00ff00' } }).png().toBuffer();
    const r2 = await u.req('PATCH', '/me', { avatarUploadId: await uploadMedia(u, 'avatar', png, 'image/png'), bannerUploadId: null });
    expect(r2.body.user.avatarUrl).toBe(r2.body.user.avatarStaticUrl); // still image: same url
    expect(r2.body.user.bannerUrl).toBeNull();
    expect(await headObject(row1.avatarKey!)).toBeNull();
    expect(await headObject(row1.avatarStaticKey!)).toBeNull();
    expect(await headObject(row1.bannerKey!)).toBeNull();
  });
});

describe('message speed paths', () => {
  it('pages through history with a cursor and echoes the client nonce', async () => {
    const u = await (await mk().guest('Pager')).connect();
    const { s, text } = await sessionWith(u);
    const first = await u.req('POST', `/channels/${text.id}/messages`, { content: 'm1', nonce: 'abc123' });
    expect(first.body.message.nonce).toBe('abc123');
    for (let i = 2; i <= 12; i++) await u.req('POST', `/channels/${text.id}/messages`, { content: `m${i}` });
    const pages: string[] = [];
    let before = '';
    for (let k = 0; k < 3; k++) {
      const p = (await u.req('GET', `/channels/${text.id}/messages?limit=5${before ? `&before=${before}` : ''}`)).body;
      pages.push(p.messages.map((m: { content: string }) => m.content).join(',') + (p.hasMore ? '+' : ''));
      before = p.messages[0]?.id;
    }
    expect(pages).toEqual(['m8,m9,m10,m11,m12+', 'm3,m4,m5,m6,m7+', 'm1,m2']);
    await u.exit(s.id);
  });
});
