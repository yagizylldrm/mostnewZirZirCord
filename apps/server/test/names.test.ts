import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/db';
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

describe('naming rules', () => {
  it('rejects short names, spaces and invisible characters at sign-up', async () => {
    const c = mk();
    for (const displayName of ['Mobil', 'Yağız Efe', 'abc​def', 'ㅤㅤㅤㅤㅤㅤ']) {
      const r = await c.req('POST', '/auth/guest', { displayName, deviceId: c.deviceId });
      expect(r.status, displayName).toBe(400);
    }
    const ok = await c.req('POST', '/auth/guest', { displayName: 'Mobil_1', deviceId: c.deviceId });
    expect(ok.status).toBe(200);
  });

  it('applies to profile changes, but an older short name can stay while editing the rest', async () => {
    const c = mk();
    await c.guest('Profile');
    expect((await c.req('PATCH', '/me', { displayName: 'Short' })).status).toBe(400);
    expect((await c.req('PATCH', '/me', { displayName: 'with space' })).status).toBe(400);
    expect((await c.req('PATCH', '/me', { displayName: 'Longer_name' })).status).toBe(200);

    // An account made before the rule has a short name; saving something else must not fail.
    await prisma.user.update({ where: { id: c.userId }, data: { displayName: 'Old' } });
    expect((await c.req('PATCH', '/me', { displayName: 'Old', bio: 'hello' })).status).toBe(200);
    expect((await c.req('PATCH', '/me', { displayName: 'Older' })).status).toBe(400);
  });

  it('applies to session nicknames; clearing is always allowed', async () => {
    const c = mk();
    await c.guest('Nickname');
    const s = (await c.req('POST', '/sessions', { name: 'Names' })).body.session;
    const nick = (nickname: string | null) => c.req('PATCH', `/sessions/${s.id}/members/me`, { nickname });
    expect((await nick('Tiny')).status).toBe(400);
    expect((await nick('has space')).status).toBe(400);
    expect((await nick('​​​​​​')).status).toBe(400);
    expect((await nick('Nick_name')).status).toBe(200);
    expect((await nick(null)).status).toBe(200);
    expect((await nick('')).status).toBe(200);
  });
});
