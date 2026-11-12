import { can, canModerate } from '@zirzircord/shared';
import { Copy, Crown } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { copyText } from '../lib/format';
import { ui, useApp, useUi, zz } from '../lib/zz';
import { Avatar, Banner, RoleBadge } from './ui';

export function ProfilePopover() {
  const profile = useUi((u) => u.profile);
  const { view, meId } = useApp((s) => ({ view: profile ? s.sessions[profile.sessionId] : undefined, meId: s.me!.id }));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const member = profile && view?.members[profile.userId];

  useLayoutEffect(() => {
    if (!profile || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(profile.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(profile.y, window.innerHeight - r.height - 8)),
    });
  }, [profile, member]);

  if (!profile || !view || !member) return null;
  const close = () => ui.setState({ profile: null });
  const sid = view.session.id;
  const u = member.user;
  const isMe = u.id === meId;
  const mayModerate = !isMe && canModerate(view.myRole, member.role);
  const act = (fn: () => Promise<unknown>, msg: string) => async () => {
    close();
    if ((await zz.attempt(fn)) !== undefined) zz.notify(msg, 'success');
  };

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={close} />
      <div ref={ref} className="fixed z-50 w-72 overflow-hidden rounded-xl bg-elev shadow-2xl" style={pos}>
        <Banner user={u} height={96} animate />
        <div className="px-4 pb-4">
          <div className="-mt-9 mb-2 w-fit rounded-full border-[5px] border-elev">
            <Avatar name={u.displayName} url={u.avatarUrl} staticUrl={u.avatarStaticUrl} size={72} status={u.status} animate />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">{member.nickname || u.displayName}</h3>
            {view.presence.hostId === u.id && <Crown size={16} className="text-brand-2" aria-label="Host" />}
            <RoleBadge role={member.role} />
            {member.serverMuted && <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger">MUTED</span>}
          </div>
          {member.nickname && <div className="text-sm text-muted">{u.displayName}</div>}
          <button
            className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted hover:text-fg"
            onClick={async () => (await copyText(u.publicId)) && zz.notify('ID copied', 'success')}
          >
            {u.publicId} <Copy size={12} />
          </button>
          {u.isGuest && <div className="mt-1 text-xs text-faint">Guest</div>}
          {u.bio && <p className="mt-3 rounded-md bg-side p-2 text-sm whitespace-pre-wrap">{u.bio}</p>}

          {(mayModerate || (view.myRole === 'OWNER' && !isMe)) && (
            <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              {view.myRole === 'OWNER' && !isMe && member.role !== 'OWNER' && (
                <button
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-hover"
                  onClick={
                    member.role === 'MOD'
                      ? act(() => zz.api.removeMod(sid, u.id), 'Moderator removed')
                      : act(() => zz.api.addMod(sid, u.publicId), 'Moderator added')
                  }
                >
                  {member.role === 'MOD' ? 'Remove moderator' : 'Make moderator'}
                </button>
              )}
              {view.myRole === 'OWNER' && !isMe && (
                <button
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-hover"
                  onClick={() => confirm(`Transfer ownership to ${u.displayName}? You will become a moderator.`) && act(() => zz.api.transferOwnership(sid, u.publicId), 'Ownership transferred')()}
                >
                  Transfer ownership
                </button>
              )}
              {mayModerate && can(view.myRole, 'voice.serverMute') && (
                <button
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-hover"
                  onClick={act(() => zz.api.serverMute(sid, u.id, !member.serverMuted), member.serverMuted ? 'Server mute removed' : 'Server muted')}
                >
                  {member.serverMuted ? 'Remove server mute' : 'Server mute (can’t talk in voice)'}
                </button>
              )}
              {mayModerate && can(view.myRole, 'session.kick') && (
                <button className="w-full rounded px-2 py-1.5 text-left text-danger hover:bg-danger hover:text-white" onClick={act(() => zz.api.kick(sid, u.id), 'Kicked')}>
                  Kick from session
                </button>
              )}
              {mayModerate && can(view.myRole, 'session.ban') && (
                <button
                  className="w-full rounded px-2 py-1.5 text-left text-danger hover:bg-danger hover:text-white"
                  onClick={() => {
                    const reason = prompt(`Ban ${u.displayName}? Optional reason:`);
                    if (reason !== null) act(() => zz.api.ban(sid, { userId: u.id }, reason || undefined), 'Banned')();
                  }}
                >
                  Ban from session
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
