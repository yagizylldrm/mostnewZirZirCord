import { Maximize2, MonitorUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ui, useApp, useCall, useUi, zz } from '../lib/zz';
import { ScreenMuteButton } from './CallView';
import { cx } from './ui';
import { VideoEl } from './VideoEl';

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const POS_KEY = 'zz.miniScreenCorner';
// Keep clear of the header (top) and the message composer (bottom).
const MARGIN = { x: 16, top: 64, bottom: 96 };

const loadCorner = (): Corner => {
  try {
    const c = localStorage.getItem(POS_KEY);
    return c === 'tl' || c === 'tr' || c === 'bl' || c === 'br' ? c : 'br';
  } catch {
    return 'br';
  }
};

const cornerStyle = (c: Corner): React.CSSProperties => ({
  [c[0] === 't' ? 'top' : 'bottom']: c[0] === 't' ? MARGIN.top : MARGIN.bottom,
  [c[1] === 'l' ? 'left' : 'right']: MARGIN.x,
});

/**
 * A minimized screen share: a small draggable window that stays on top while
 * you chat or browse other channels. Drop it anywhere and it snaps to the
 * nearest corner.
 */
export function FloatingScreen() {
  const mini = useUi((u) => u.miniScreen);
  const c = useCall((c) => ({
    status: c.status,
    sessionId: c.sessionId,
    participants: c.participants,
  }));
  const p = mini && c.sessionId === mini.sessionId ? c.participants.find((x) => x.id === mini.identity && x.screenSharing) : undefined;
  const name = useApp((s) => {
    if (!mini) return '';
    const m = s.sessions[mini.sessionId]?.members[mini.identity];
    return m?.nickname || m?.user.displayName || '';
  });
  const [corner, setCorner] = useState<Corner>(loadCorner);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const grab = useRef({ dx: 0, dy: 0, moved: false });

  // The share ended or the call is over: close the mini player (not during a brief reconnect).
  useEffect(() => {
    if (mini && !p && (c.status === 'connected' || c.status === 'idle')) ui.setState({ miniScreen: null });
  }, [mini, p, c.status]);

  if (!mini || !p) return null;

  const expand = () => {
    if (zz.state.activeSessionId !== mini.sessionId) zz.setActiveSession(mini.sessionId);
    // CallView puts this stream on its stage and clears the mini player.
    ui.setState((u) => ({
      callView: { ...u.callView, [mini.sessionId]: true },
    }));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = box.current!.getBoundingClientRect();
    grab.current = {
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ x: r.left, y: r.top });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    grab.current.moved = true;
    const r = box.current!.getBoundingClientRect();
    setDrag({
      x: Math.min(Math.max(e.clientX - grab.current.dx, 0), window.innerWidth - r.width),
      y: Math.min(Math.max(e.clientY - grab.current.dy, 0), window.innerHeight - r.height),
    });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const r = box.current!.getBoundingClientRect();
    const next: Corner = `${r.top + r.height / 2 < window.innerHeight / 2 ? 't' : 'b'}${r.left + r.width / 2 < window.innerWidth / 2 ? 'l' : 'r'}`;
    setDrag(null);
    setCorner(next);
    try {
      localStorage.setItem(POS_KEY, next);
    } catch {}
    if (!grab.current.moved) expand(); // a plain click opens the call
  };

  const btn = 'rounded-md bg-black/60 p-1.5 hover:bg-black/80';
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={`${p.isLocal ? 'Your' : `${name}'s`} screen (mini player)`}
      className={cx(
        'group fixed z-40 aspect-video w-80 max-w-[60vw] cursor-grab touch-none overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10 select-none',
        drag && 'cursor-grabbing',
      )}
      style={drag ? { left: drag.x, top: drag.y } : cornerStyle(corner)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <VideoEl identity={p.id} source="screen" contain />
      <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex max-w-[70%] items-center gap-1 truncate rounded bg-black/60 px-1.5 py-0.5 text-xs">
        <MonitorUp size={12} className="shrink-0 text-ok" />
        <span className="truncate">{p.isLocal ? 'Your screen' : `${name}'s screen`}</span>
      </div>
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100 max-md:opacity-100">
        <ScreenMuteButton p={p} className={btn} />
        <button className={btn} onClick={expand} aria-label="Expand" title="Back to the call">
          <Maximize2 size={16} />
        </button>
        <button className={btn} onClick={() => ui.setState({ miniScreen: null })} aria-label="Close mini player" title="Close (keeps you in the call)">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
