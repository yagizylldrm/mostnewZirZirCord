import { GIF_PAGE_SIZE, GIF_RATING_INFO, type GifDTO, type GifPage, type GifRating } from '@zirzircord/shared';
import { env } from '../env';
import { HttpError, badRequest, forbidden } from './errors';
import { redis } from './redis';

/**
 * GIPHY (the GIF library Instagram uses). The API key never leaves the server:
 * clients search through us, results are cached (the free key allows ~100 calls/hour),
 * and GIFs are shown straight from GIPHY's servers, as their terms ask.
 */
const SEARCH_TTL_S = 10 * 60;
const GIF_TTL_S = 24 * 60 * 60;
const TIMEOUT_MS = 5000;
const ORDER = ['g', 'pg', 'pg-13', 'r'] as const;

const disabled = () => new HttpError(503, 'gifs_disabled', "GIFs aren't set up on this server");
const unavailable = () => new HttpError(503, 'gifs_unavailable', 'GIPHY is not answering right now. Try again in a moment.');

/** Only GIPHY's own https media hosts are ever stored or shown. */
function giphyUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && (url.hostname === 'giphy.com' || url.hostname.endsWith('.giphy.com')) ? url.toString() : null;
  } catch {
    return null;
  }
}

interface RawGif {
  id?: unknown;
  title?: unknown;
  rating?: unknown;
  images?: Record<string, Record<string, unknown> | undefined>;
}

/** Maps a GIPHY object to what we store / send. Returns null if it lacks usable GIPHY URLs. */
export function toGif(raw: RawGif): GifDTO | null {
  const img = raw.images ?? {};
  const main = img.downsized_medium ?? img.downsized ?? img.original;
  const url = giphyUrl(main?.url);
  const preview = giphyUrl(img.fixed_width?.webp) ?? giphyUrl(img.fixed_width?.url) ?? url;
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(raw.id) || !url || !preview) return null;
  const width = Number(main?.width) || Number(img.original?.width) || 200;
  const height = Number(main?.height) || Number(img.original?.height) || 200;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 140) : '',
    url,
    mp4Url: giphyUrl(img.original_mp4?.mp4) ?? giphyUrl(img.original?.mp4),
    previewUrl: preview,
    width,
    height,
  };
}

async function call(path: string, params: Record<string, string>): Promise<any> {
  if (!env.GIPHY_API_KEY) throw disabled();
  const url = new URL(path, env.GIPHY_API_URL);
  for (const [k, v] of Object.entries({ api_key: env.GIPHY_API_KEY, ...params })) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw unavailable();
  }
  if (res.status === 404) return null;
  if (!res.ok) throw unavailable(); // 429 (key over its limit), 5xx…
  return res.json().catch(() => {
    throw unavailable();
  });
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = await redis.get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as T;
  const value = await load();
  await redis.set(key, JSON.stringify(value), 'EX', ttl).catch(() => {});
  return value;
}

function toPage(body: any, offset: number): GifPage {
  const gifs = (Array.isArray(body?.data) ? body.data : []).map(toGif).filter((g: GifDTO | null): g is GifDTO => !!g);
  const total = Number(body?.pagination?.total_count) || 0;
  const next = offset + GIF_PAGE_SIZE;
  return { gifs, nextOffset: next < Math.min(total, 5000) ? next : null };
}

export async function searchGifs(q: string, offset: number, rating: GifRating): Promise<GifPage> {
  const r = GIF_RATING_INFO[rating].giphy;
  const term = q.trim().toLowerCase();
  if (!term) return trendingGifs(offset, rating);
  if (!env.GIPHY_API_KEY) throw disabled();
  return cached(`gif:search:${r}:${term}:${offset}`, SEARCH_TTL_S, async () =>
    toPage(await call('/v1/gifs/search', { q: term, offset: String(offset), limit: String(GIF_PAGE_SIZE), rating: r, bundle: 'messaging_non_clips' }), offset),
  );
}

export async function trendingGifs(offset: number, rating: GifRating): Promise<GifPage> {
  const r = GIF_RATING_INFO[rating].giphy;
  if (!env.GIPHY_API_KEY) throw disabled();
  return cached(`gif:trending:${r}:${offset}`, SEARCH_TTL_S, async () =>
    toPage(await call('/v1/gifs/trending', { offset: String(offset), limit: String(GIF_PAGE_SIZE), rating: r, bundle: 'messaging_non_clips' }), offset),
  );
}

/** Looks a GIF up at GIPHY (never trusting client URLs) and checks it fits the session's rating. */
export async function getGif(id: string, maxRating: GifRating): Promise<GifDTO> {
  if (!env.GIPHY_API_KEY) throw disabled();
  const found = await cached(`gif:id:${id}`, GIF_TTL_S, async () => {
    const body = await call(`/v1/gifs/${encodeURIComponent(id)}`, {});
    const gif = body?.data ? toGif(body.data) : null;
    return gif ? { gif, rating: typeof body.data.rating === 'string' ? body.data.rating.toLowerCase() : 'r' } : null;
  });
  if (!found) throw badRequest('That GIF could not be found', 'unknown_gif');
  const rank = (r: string) => {
    const i = ORDER.indexOf(r as (typeof ORDER)[number]);
    return i < 0 ? ORDER.length - 1 : i; // unknown ratings count as R
  };
  if (rank(found.rating) > rank(GIF_RATING_INFO[maxRating].giphy)) {
    throw forbidden(`That GIF is rated above this session's limit (${GIF_RATING_INFO[maxRating].label})`, 'gif_rating');
  }
  return found.gif;
}
