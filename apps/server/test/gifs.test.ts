import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { env } from '../src/env';
import { prisma } from '../src/lib/db';
import { redis } from '../src/lib/redis';
import { Client, startServer } from './helpers';

let app: FastifyInstance;
let base: string;
const clients: Client[] = [];
const mk = () => {
  const c = new Client(base);
  clients.push(c);
  return c;
};

// ---- a tiny fake GIPHY ----
const calls: URL[] = [];
let giphy: Server;
const gif = (id: string, rating = 'g', host = 'media.giphy.com') => ({
  id,
  title: `GIF ${id}`,
  rating,
  images: {
    downsized_medium: { url: `https://${host}/media/${id}/giphy.gif`, width: '480', height: '270' },
    original_mp4: { mp4: `https://${host}/media/${id}/giphy.mp4` },
    fixed_width: { webp: `https://${host}/media/${id}/200w.webp`, url: `https://${host}/media/${id}/200w.gif` },
    original: { width: '480', height: '270' },
  },
});
const KNOWN: Record<string, ReturnType<typeof gif>> = { abc123: gif('abc123', 'g'), spicy1: gif('spicy1', 'r') };

beforeAll(async () => {
  giphy = createServer((req, res) => {
    const url = new URL(req.url!, 'http://fake');
    calls.push(url);
    const json = (status: number, body: unknown) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)));
    if (url.searchParams.get('api_key') !== 'test-key') return json(401, { message: 'bad key' });
    if (url.searchParams.get('q') === 'ratelimit') return json(429, { message: 'limit' });
    if (url.pathname === '/v1/gifs/search' || url.pathname === '/v1/gifs/trending') {
      // One good GIF, one pointing somewhere else (must be dropped).
      return json(200, { data: [gif('good1'), gif('evil1', 'g', 'evil.example')], pagination: { total_count: 100, count: 2, offset: 0 } });
    }
    const m = /^\/v1\/gifs\/(\w+)$/.exec(url.pathname);
    if (m && KNOWN[m[1]]) return json(200, { data: KNOWN[m[1]] });
    return json(404, { message: 'not found' });
  });
  await new Promise<void>((r) => giphy.listen(0, '127.0.0.1', r));
  env.GIPHY_API_URL = `http://127.0.0.1:${(giphy.address() as AddressInfo).port}`;
  env.GIPHY_API_KEY = 'test-key';
  ({ app, base } = await startServer());
});
afterAll(async () => {
  clients.forEach((c) => c.close());
  await app.close();
  giphy.close();
});
beforeEach(async () => {
  calls.length = 0;
  env.GIPHY_API_KEY = 'test-key';
  const keys = await redis.keys('gif:*');
  if (keys.length) await redis.del(...keys);
});

async function sessionWith(owner: Client, ...others: Client[]) {
  const s = (await owner.req('POST', '/sessions', { name: 'GIFs' })).body.session;
  const snap = await owner.enter(s.id);
  for (const o of others) {
    await o.req('POST', '/sessions/join', { code: s.code });
    await o.enter(s.id);
  }
  return { s, text: snap.channels.find((c) => c.type === 'TEXT')! };
}

describe('GIF search', () => {
  it('searches through the server with the session rating, keeps only GIPHY URLs and caches', async () => {
    const u = await (await mk().guest('Searcher')).connect();
    const outsider = await mk().guest('Outsider');
    const { s } = await sessionWith(u);
    expect(s.gifRating).toBe('PG13');

    const r = await u.req('GET', `/sessions/${s.id}/gifs/search?q=Cat`);
    expect(r.status).toBe(200);
    expect(r.body.gifs.map((g: any) => g.id)).toEqual(['good1']); // the non-GIPHY one is dropped
    expect(r.body.gifs[0]).toMatchObject({ url: 'https://media.giphy.com/media/good1/giphy.gif', mp4Url: 'https://media.giphy.com/media/good1/giphy.mp4', width: 480, height: 270 });
    expect(r.body.nextOffset).toBe(24);
    expect(calls[0].pathname).toBe('/v1/gifs/search');
    expect(calls[0].searchParams.get('rating')).toBe('pg-13');
    expect(calls[0].searchParams.get('q')).toBe('cat');

    await u.req('GET', `/sessions/${s.id}/gifs/search?q=cat`);
    expect(calls).toHaveLength(1); // second time from the cache

    expect((await u.req('GET', `/sessions/${s.id}/gifs/trending`)).body.gifs).toHaveLength(1);
    expect(calls.at(-1)!.pathname).toBe('/v1/gifs/trending');
    expect((await outsider.req('GET', `/sessions/${s.id}/gifs/trending`)).status).toBe(404);
  });

  it('reports a missing key and GIPHY trouble clearly', async () => {
    const u = await (await mk().guest('Unlucky')).connect();
    const { s } = await sessionWith(u);
    const limited = await u.req('GET', `/sessions/${s.id}/gifs/search?q=ratelimit`);
    expect([limited.status, limited.body.error]).toEqual([503, 'gifs_unavailable']);
    env.GIPHY_API_KEY = undefined;
    const off = await u.req('GET', `/sessions/${s.id}/gifs/trending`);
    expect([off.status, off.body.error]).toEqual([503, 'gifs_disabled']);
  });

  it('limits searches to 30 per minute per user', async () => {
    const u = await (await mk().guest('Busy')).connect();
    const { s } = await sessionWith(u);
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await u.req('GET', `/sessions/${s.id}/gifs/search?q=x${i}`)).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});

describe('GIF rating', () => {
  it('only the owner changes it, and searches follow it', async () => {
    const owner = await (await mk().register('Rating owner')).connect();
    const mod = await (await mk().register('Rating mod')).connect();
    const { s } = await sessionWith(owner, mod);
    await owner.req('POST', `/sessions/${s.id}/mods`, { publicId: mod.publicId });

    expect((await mod.req('PATCH', `/sessions/${s.id}`, { gifRating: 'R' })).status).toBe(403);
    expect((await owner.req('PATCH', `/sessions/${s.id}`, { gifRating: 'NC17' })).status).toBe(400);
    const r = await owner.req('PATCH', `/sessions/${s.id}`, { gifRating: 'G' });
    expect(r.body.session.gifRating).toBe('G');
    const live = await mod.waitFor('session:updated', (p) => p.id === s.id && p.gifRating === 'G');
    expect(live.gifRating).toBe('G');
    // Mods can still change other settings in the same request style.
    expect((await mod.req('PATCH', `/sessions/${s.id}`, { accountsOnly: true, gifRating: 'G' })).status).toBe(200);

    await mod.req('GET', `/sessions/${s.id}/gifs/search?q=dog`);
    expect(calls.at(-1)!.searchParams.get('rating')).toBe('g');
  });
});

describe('sending GIFs', () => {
  it('stores the GIF as looked up by the server, and refuses unknown or too-spicy ones', async () => {
    const a = await (await mk().register('Sender')).connect();
    const b = await (await mk().guest('Viewer')).connect();
    const { s, text } = await sessionWith(a, b);

    const sent = await a.req('POST', `/channels/${text.id}/messages`, { gifId: 'abc123' });
    expect(sent.status).toBe(200);
    expect(sent.body.message.gif).toMatchObject({ id: 'abc123', url: 'https://media.giphy.com/media/abc123/giphy.gif' });
    const live = await b.waitFor('message:new', (m) => m.id === sent.body.message.id);
    expect(live.gif.id).toBe('abc123');
    const history = (await b.req('GET', `/channels/${text.id}/messages`)).body.messages;
    expect(history.find((m: any) => m.id === sent.body.message.id).gif.title).toBe('GIF abc123');
    const row = await prisma.message.findUniqueOrThrow({ where: { id: sent.body.message.id } });
    expect((row.gif as any).url).toBe('https://media.giphy.com/media/abc123/giphy.gif');

    expect((await a.req('POST', `/channels/${text.id}/messages`, { gifId: 'nope99' })).body.error).toBe('unknown_gif');
    expect((await a.req('POST', `/channels/${text.id}/messages`, { gifId: 'https://evil.example/x.gif' })).status).toBe(400);
    // Client-supplied GIF data is ignored: only the id counts.
    const sneaky = await a.req('POST', `/channels/${text.id}/messages`, { gifId: 'abc123', gif: { url: 'https://evil.example/x.gif' } } as any);
    expect(sneaky.body.message.gif.url).toBe('https://media.giphy.com/media/abc123/giphy.gif');

    // R-rated GIF: fine under R, refused under the default PG-13.
    const spicy = await a.req('POST', `/channels/${text.id}/messages`, { gifId: 'spicy1' });
    expect([spicy.status, spicy.body.error]).toEqual([403, 'gif_rating']);
    await a.req('PATCH', `/sessions/${s.id}`, { gifRating: 'R' });
    expect((await a.req('POST', `/channels/${text.id}/messages`, { gifId: 'spicy1' })).status).toBe(200);
  });
});
