import { Home as HomeIcon, LogIn, Plus } from 'lucide-react';
import type { SessionDTO } from '@zirzircord/shared';
import { isSessionMuted, sessionUnread } from '@zirzircord/client-core';
import { colorFor, initials } from '../lib/format';
import { openModal, useApp, useCall, zz } from '../lib/zz';
import { Logo, cx } from './ui';

function SessionIcon({
  s,
  active,
  live,
  inCall,
  unread,
  onClick,
}: {
  s: SessionDTO;
  active: boolean;
  live?: boolean;
  inCall?: boolean;
  unread?: { count: number; mentions: number; muted: boolean };
  onClick: () => void;
}) {
  const showDot = !active && !!unread?.count && !unread.muted;
  return (
    <div className="group relative flex w-full justify-center">
      <span
        className={cx(
          'absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r bg-fg transition-all',
          active ? 'h-10' : showDot ? 'h-2' : 'h-2 opacity-0 group-hover:h-5 group-hover:opacity-100',
        )}
      />
      <button
        onClick={onClick}
        title={s.name}
        className={cx(
          'relative grid size-12 place-items-center font-semibold text-white transition-all',
          active ? 'rounded-2xl' : 'rounded-3xl hover:rounded-2xl',
        )}
        style={{ background: colorFor(s.id) }}
      >
        {initials(s.name)}
        {live !== undefined && (
          <span className={cx('absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[3px] border-rail', live ? 'bg-ok' : 'bg-faint')} />
        )}
        {inCall && <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-rail bg-ok pulse-dot" />}
        {!!unread?.mentions && (
          <span className="absolute -right-1 -bottom-1 min-w-5 rounded-full border-[3px] border-rail bg-danger px-1 text-[11px] leading-[14px] font-bold text-white">
            {unread.mentions > 99 ? '99+' : unread.mentions}
          </span>
        )}
      </button>
    </div>
  );
}

export function SessionRail() {
  const { sessions, activeSessionId, setSessions, unreadKey } = useApp((s) => ({
    sessions: s.sessions,
    activeSessionId: s.activeSessionId,
    setSessions: s.sidebar.setSessions,
    // serialised so the shallow selector only changes when counts change
    unreadKey: JSON.stringify(
      Object.keys(s.sessions).map((sid) => {
        const u = sessionUnread(s, sid);
        return [sid, u.count, u.mentions, isSessionMuted(s, sid)];
      }),
    ),
  }));
  const unreadBy = Object.fromEntries(
    (JSON.parse(unreadKey) as [string, number, number, boolean][]).map(([sid, count, mentions, muted]) => [sid, { count, mentions, muted }]),
  );
  const callSession = useCall((c) => c.sessionId);
  const open = Object.values(sessions);
  const closedSet = setSessions.filter((i) => !sessions[i.session.id]);

  return (
    <nav className="flex h-full w-[72px] flex-col items-center gap-2 overflow-y-auto bg-rail py-3">
      <button
        title="Home"
        onClick={() => zz.setActiveSession(null)}
        className={cx('grid size-12 place-items-center rounded-2xl transition', !activeSessionId ? 'bg-brand' : 'bg-side hover:bg-brand')}
      >
        {activeSessionId ? <HomeIcon size={22} /> : <Logo size={30} />}
      </button>
      <div className="h-0.5 w-8 rounded bg-line" />
      {open.map((v) => (
        <SessionIcon
          key={v.session.id}
          s={v.session}
          active={v.session.id === activeSessionId}
          inCall={callSession === v.session.id}
          unread={unreadBy[v.session.id]}
          onClick={() => zz.setActiveSession(v.session.id)}
        />
      ))}
      {closedSet.length > 0 && (
        <>
          <div className="mt-1 text-[10px] font-bold tracking-wider text-faint">SET</div>
          {closedSet.map((i) => (
            <SessionIcon key={i.session.id} s={i.session} active={false} live={i.live} onClick={() => zz.attempt(() => zz.openSession(i.session.id))} />
          ))}
        </>
      )}
      <div className="h-0.5 w-8 rounded bg-line" />
      <button
        title="Create a session"
        onClick={() => openModal({ type: 'createSession' })}
        className="grid size-12 place-items-center rounded-3xl bg-side text-ok transition-all hover:rounded-2xl hover:bg-ok hover:text-white"
      >
        <Plus size={22} />
      </button>
      <button
        title="Join with a code"
        onClick={() => openModal({ type: 'joinSession' })}
        className="grid size-12 place-items-center rounded-3xl bg-side text-brand transition-all hover:rounded-2xl hover:bg-brand hover:text-white"
      >
        <LogIn size={20} />
      </button>
    </nav>
  );
}
