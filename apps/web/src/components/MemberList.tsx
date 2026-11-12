import { listedMembers, memberName } from '@zirzircord/client-core';
import { Crown, MicOff } from 'lucide-react';
import { ui, useApp } from '../lib/zz';
import { Avatar, RoleBadge, cx } from './ui';

export function MemberList() {
  const view = useApp((s) => s.sessions[s.activeSessionId!]);
  if (!view) return null;
  const order = new Map(view.presence.present.map((p, i) => [p.userId, i]));
  const online = listedMembers(view)
    .filter((m) => order.has(m.user.id))
    .sort((a, b) => order.get(a.user.id)! - order.get(b.user.id)!);
  const offline = listedMembers(view).filter((m) => !order.has(m.user.id));

  const row = (m: (typeof online)[number], present: boolean) => {
    const isHost = view.presence.hostId === m.user.id;
    return (
      <button
        key={m.user.id}
        onClick={(e) => ui.setState({ profile: { userId: m.user.id, sessionId: view.session.id, x: e.clientX, y: e.clientY } })}
        className={cx('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover', !present && 'opacity-40')}
      >
        <Avatar name={memberName(view, m.user.id)} url={m.user.avatarUrl} staticUrl={m.user.avatarStaticUrl} size={32} status={present ? m.user.status : null} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cx('truncate text-sm font-medium', m.role === 'OWNER' ? 'text-owner' : m.role === 'MOD' ? 'text-mod' : '')}>
              {memberName(view, m.user.id)}
            </span>
            {isHost && <Crown size={14} className="shrink-0 text-brand-2" aria-label="Host" />}
            {m.serverMuted && <MicOff size={13} className="shrink-0 text-danger" aria-label="Muted by a moderator" />}
          </div>
          {m.user.bio && <div className="truncate text-xs text-muted">{m.user.bio}</div>}
        </div>
        <RoleBadge role={m.role} />
      </button>
    );
  };

  return (
    <aside className="h-full w-60 overflow-y-auto bg-side px-2 py-4">
      <h3 className="px-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">Here now — {online.length}</h3>
      {online.map((m) => row(m, true))}
      {offline.length > 0 && (
        <>
          <h3 className="px-2 pt-4 pb-1 text-xs font-bold tracking-wide text-muted uppercase">Away — {offline.length}</h3>
          {offline.map((m) => row(m, false))}
        </>
      )}
    </aside>
  );
}
