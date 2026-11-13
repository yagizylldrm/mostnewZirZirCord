import { CLIENT_HEADER } from '@zirzircord/shared';
import { env } from '../env';

/**
 * "Only our apps may use the API" — as far as a server can tell:
 *  - Browsers always send Origin on cross-site calls, so a request from any other
 *    website is refused outright (CORS alone would still run it, only hide the answer).
 *  - Requests without a web origin (phone app, Electron file://) must carry the
 *    official X-ZZ-Client header.
 * A script holding a valid token can copy all of this; per-user rate limits and
 * timeouts are what keep such clients in check.
 */
const CLIENT_RE = /^(web|desktop|tauri|mobile)\/[\w.+-]{1,32}$/;

// Exact origins, or patterns like https://zirzircord-*-team.vercel.app ('*' = one DNS label part).
const corsPatterns = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`, 'i'));

/** A real web origin from the allowlist. */
export const isAllowedOrigin = (origin: string) => corsPatterns.some((re) => re.test(origin));

/** For CORS: no origin / "null" (apps) is fine here — checkClient decides about those. */
export const corsOriginAllowed = (origin: string | undefined) => !origin || origin === 'null' || isAllowedOrigin(origin);

export type ClientVerdict = { ok: true } | { ok: false; code: 'bad_origin' | 'app_required'; message: string };

export function checkClient(origin: string | undefined, client: unknown): ClientVerdict {
  if (origin && origin !== 'null') {
    // Only our own pages can make a browser send our origin, so that alone is enough
    // (it also keeps already-deployed website builds working).
    return isAllowedOrigin(origin) ? { ok: true } : { ok: false, code: 'bad_origin', message: 'Requests from this website are not allowed' };
  }
  if (typeof client !== 'string' || !CLIENT_RE.test(client)) {
    return { ok: false, code: 'app_required', message: 'Please use the ZirZirCord app or website' };
  }
  return { ok: true };
}

export const enforceClientCheck = () => env.CLIENT_CHECK === 'enforce';
export { CLIENT_HEADER };
