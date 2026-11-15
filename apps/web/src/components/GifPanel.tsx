import { GIF_RATING_INFO, type GifDTO } from '@zirzircord/shared';
import { ApiError } from '@zirzircord/client-core';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp, zz } from '../lib/zz';

/** GIF picker (GIPHY, the library Instagram uses). Trending when empty; search as you type; scroll for more. */
export function GifPanel({ sessionId, onSend, onClose }: { sessionId: string; onSend: (gif: GifDTO) => void; onClose: () => void }) {
  const rating = useApp((s) => s.sessions[sessionId]?.session.gifRating ?? 'PG13');
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<GifDTO[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useRef('');
  const input = useRef<HTMLInputElement>(null);

  const load = async (term: string, offset: number) => {
    setLoading(true);
    try {
      const page = term ? await zz.api.searchGifs(sessionId, term, offset) : await zz.api.trendingGifs(sessionId, offset);
      if (query.current !== term) return; // an older search finished late
      setGifs((g) => (offset === 0 ? page.gifs : [...g, ...page.gifs.filter((x) => !g.some((y) => y.id === x.id))]));
      setNext(page.nextOffset);
      setError(null);
    } catch (e) {
      if (query.current !== term) return;
      setError(
        e instanceof ApiError && e.code === 'gifs_disabled'
          ? 'GIFs aren’t set up on this server yet.'
          : e instanceof ApiError && e.status === 429
            ? 'Too many searches. Wait a moment and try again.'
            : e instanceof Error
              ? e.message
              : 'Could not load GIFs',
      );
    } finally {
      if (query.current === term) setLoading(false);
    }
  };

  // Search 300 ms after typing stops (trending when empty); also reload when the session's rating changes.
  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(
      () => {
        query.current = term;
        setNext(0);
        load(term, 0);
      },
      term ? 300 : 0,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, rating, sessionId]);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!loading && next !== null && next > 0 && el.scrollTop + el.clientHeight > el.scrollHeight - 200) load(query.current, next);
  };

  // Two columns, each GIF placed in the shorter one (masonry).
  const cols: [GifDTO[], GifDTO[]] = [[], []];
  const heights = [0, 0];
  for (const g of gifs) {
    const i = heights[0] <= heights[1] ? 0 : 1;
    cols[i].push(g);
    heights[i] += g.height / g.width;
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 bottom-full z-40 mb-2 flex h-[420px] w-[min(380px,calc(100vw-32px))] flex-col rounded-xl bg-elev p-3 shadow-2xl">
        <label className="mb-2 flex items-center gap-2 rounded-md bg-field px-2.5">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={100}
            placeholder="Search GIPHY"
            aria-label="Search GIFs"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto" onScroll={onScroll}>
          {error ? (
            <p className="p-6 text-center text-sm text-muted">{error}</p>
          ) : !gifs.length && !loading ? (
            <p className="p-6 text-center text-sm text-muted">No GIFs found{q.trim() ? ` for “${q.trim()}”` : ''}.</p>
          ) : (
            <div className="flex gap-1.5">
              {cols.map((col, i) => (
                <div key={i} className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {col.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => onSend(g)}
                      title={g.title || 'Send GIF'}
                      aria-label={`Send GIF${g.title ? `: ${g.title}` : ''}`}
                      className="overflow-hidden rounded-md bg-field hover:ring-2 hover:ring-brand focus-visible:ring-2 focus-visible:ring-brand"
                      style={{ aspectRatio: `${g.width} / ${g.height}` }}
                    >
                      <img src={g.previewUrl} alt="" loading="lazy" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {loading && <p className="py-3 text-center text-xs text-faint">Loading…</p>}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-faint">
          <span className="font-semibold tracking-wide">Powered by GIPHY</span>
          <span title="The session owner chooses the highest GIF rating">Rating: {GIF_RATING_INFO[rating].label}</span>
        </div>
      </div>
    </>
  );
}
