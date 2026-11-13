import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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

async function channelWith(owner: Client, ...others: Client[]) {
  const s = (await owner.req('POST', '/sessions', { name: 'Rate limit' })).body.session;
  const snap = await owner.enter(s.id);
  for (const o of others) {
    await o.req('POST', '/sessions/join', { code: s.code });
    await o.enter(s.id);
    await sleep(5);
  }
  return snap.channels.find((c) => c.type === 'TEXT')!;
}

const send = (c: Client, channelId: string, content: string) => c.req('POST', `/channels/${channelId}/messages`, { content });

describe('message rate limit', () => {
  it('limits each account on its own, even from one shared IP', async () => {
    const a = await (await mk().guest('Flooder')).connect();
    const b = await (await mk().guest('Bystander')).connect();
    b.ip = a.ip; // same network address, like two people on one router
    const text = await channelWith(a, b);

    for (let i = 0; i < 20; i++) expect((await send(a, text.id, `msg ${i}`)).status).toBe(200);
    const blocked = await send(a, text.id, 'one too many');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('rate_limited');

    // The other account behind the same IP is not affected.
    expect((await send(b, text.id, 'still here')).status).toBe(200);
  });

  it('does not store the blocked message', async () => {
    const a = await (await mk().guest('Flooder 2')).connect();
    const text = await channelWith(a);
    for (let i = 0; i < 20; i++) await send(a, text.id, `ok ${i}`);
    await send(a, text.id, 'dropped');
    const history = (await a.req('GET', `/channels/${text.id}/messages`)).body.messages as Array<{ content: string }>;
    expect(history.some((m) => m.content === 'dropped')).toBe(false);
    expect(history).toHaveLength(20);
  });
});
