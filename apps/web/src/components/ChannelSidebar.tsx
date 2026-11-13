import { canCreateChannel, canManageChannel, can, formatSessionCode } from '@zirzircord/shared';
import { isChannelMuted, isSessionMuted, memberName } from '@zirzircord/client-core';
import { Bell, BellOff, ChevronDown, Copy, Hash, LogOut, Pencil, Plus, Settings, Tag, Volume2, Crown } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../lib/format';
import { call, openModal, ui, useApp, useCall, zz } from '../lib/zz';
import { UserPanel } from './UserPanel';
import { Avatar, cx } from './ui';
import { SessionPicture } from './SessionPicture';

export function ChannelSidebar() {
  const { view, activeChannel, me, unread, mutedChannels, sessionMuted } = useApp((s) => {
    const sid = s.activeSessionId!;
    const view = s.sessions[sid];
    return {
      view,
      activeChannel: s.activeChannel[sid],
      me: s.me!,
      unread: s.unread,
      // join into a string so the selector stays shallow-stable
      mutedChannels: (view?.channels ?? []).filter((c) => isChannelMuted(s, sid, c.id)).map((c) => c.id).join(','),
      sessionMuted: isSessionMuted(s, sid),
    };
  });
  const { callChannel, speaking } = useCall((c) => ({
    callChannel: c.channelId,
    speaking: c.participants.filter((p) => p.speaking).map((p) => p.id).join(','),
  }));
  const [menu, setMenu] = useState(false);
  if (!view) return null;
  const { session, myRole, channels, presence } = view;
  const isMod = can(myRole, 'session.editSettings');
  const text = channels.filter((c) => c.type === 'TEXT');
  const voice = channels.filter((c) => c.type === 'VOICE');
  const hostName = presence.hostId ? memberName(view, presence.hostId) : '—';

  const openText = (id: string) => {
    zz.setActiveChannel(session.id, id);
    ui.setState((u) => ({ callView: { ...u.callView, [session.id]: false }, drawerOpen: false }));
  };
  const openVoice = async (id: string) => {
    ui.setState((u) => ({ callView: { ...u.callView, [session.id]: true }, drawerOpen: false }));
    if (callChannel !== id) await call.join(session.id, id);
  };

  return (
    <aside className="flex h-full w-60 flex-col bg-side">
      <div className="relative">
        <button
          onClick={() => setMenu((m) => !m)}
          className="flex h-12 w-full items-center justify-between border-b border-black/30 px-4 font-semibold hover:bg-hover"
        >
          <span className="flex min-w-0 items-center gap-2">
            {session.iconUrl && <SessionPicture s={session} className="size-6 rounded-md text-[10px]" />}
            <span className="truncate">{session.name}</span>
            {sessionMuted && <BellOff size={14} className="shrink-0 text-faint" aria-label="Notifications muted" />}
          </span>
          <ChevronDown size={16} className={cx('transition', menu && 'rotate-180')} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute inset-x-2 top-12 z-20 space-y-0.5 rounded-lg bg-elev p-1.5 text-sm shadow-xl">
              {isMod && (
                <MenuItem icon={<Settings size={15} />} onClick={() => (setMenu(false), openModal({ type: 'sessionSettings' }))}>
                  Session settings
                </MenuItem>
              )}
              <MenuItem icon={sessionMuted ? <BellOff size={15} /> : <Bell size={15} />} onClick={() => (setMenu(false), openModal({ type: 'notifications', sessionId: session.id }))}>
                Notification settings
              </MenuItem>
              <MenuItem icon={<Tag size={15} />} onClick={() => (setMenu(false), openModal({ type: 'nickname' }))}>
                Change nickname
              </MenuItem>
              <MenuItem
                icon={<LogOut size={15} />}
                danger
                onClick={() => {
                  setMenu(false);
                  zz.leaveSession(session.id);
                }}
              >
                Leave session
              </MenuItem>
            </div>
          </>
        )}
      </div>

      <div className="space-y-1 px-3 pt-3">
        <button
          className="group flex w-full items-center justify-between rounded-md bg-rail px-3 py-2 text-left"
          onClick={async () => (await copyText(formatSessionCode(session.code))) && zz.notify('Invite code copied', 'success')}
          title="Copy invite code"
        >
          <span>
            <span className="block text-[10px] font-bold tracking-wider text-muted">INVITE CODE</span>
            <span className="font-mono text-base tracking-widest">{formatSessionCode(session.code)}</span>
          </span>
          <Copy size={16} className="text-muted group-hover:text-fg" />
        </button>
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted">
          <Crown size={12} className="text-brand-2" /> Host: <span className="truncate text-fg">{hostName}</span>
          {session.isSet && <span className="ml-auto rounded bg-brand/15 px-1.5 text-[10px] font-bold text-brand">SET</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
        <Category title="Text channels" canAdd={canCreateChannel(myRole, 'TEXT', session)} onAdd={() => openModal({ type: 'createChannel', channelType: 'TEXT' })} />
        {text.map((c) => (
          <ChannelRow
            key={c.id}
            icon={<Hash size={18} />}
            name={c.name}
            active={activeChannel === c.id && !ui.getState().callView[session.id]}
            onClick={() => openText(c.id)}
            onEdit={canManageChannel(myRole, me.id, c.createdById) ? () => openModal({ type: 'editChannel', channelId: c.id }) : undefined}
            unread={unread[c.id]}
            muted={mutedChannels.split(',').includes(c.id)}
            sessionMuted={sessionMuted}
            onToggleMute={() =>
              zz.attempt(() => zz.setChannelMute(session.id, c.id, mutedChannels.split(',').includes(c.id) ? 'unmute' : null))
            }
          />
        ))}
        <div className="h-3" />
        <Category title="Voice channels" canAdd={canCreateChannel(myRole, 'VOICE', session)} onAdd={() => openModal({ type: 'createChannel', channelType: 'VOICE' })} />
        {voice.map((c) => {
          const occupants = view.voice[c.id] ?? [];
          return (
            <div key={c.id}>
              <ChannelRow
                icon={<Volume2 size={18} />}
                name={c.name}
                active={callChannel === c.id}
                onClick={() => openVoice(c.id)}
                suffix={c.userLimit ? `${occupants.length}/${c.userLimit}` : undefined}
                onEdit={canManageChannel(myRole, me.id, c.createdById) ? () => openModal({ type: 'editChannel', channelId: c.id }) : undefined}
              />
              {occupants.map((uid) => {
                const m = view.members[uid];
                return (
                  <div key={uid} className="flex items-center gap-2 py-1 pr-2 pl-8 text-sm text-muted">
                    <Avatar
                      name={memberName(view, uid)}
                      url={m?.user.avatarUrl} staticUrl={m?.user.avatarStaticUrl}
                      size={22}
                      speaking={callChannel === c.id && speaking.split(',').includes(uid)}
                    />
                    <span className="truncate">{memberName(view, uid)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <UserPanel />
    </aside>
  );
}

function Category({ title, canAdd, onAdd }: { title: string; canAdd: boolean; onAdd: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 text-xs font-bold tracking-wide text-muted uppercase">
      {title}
      {canAdd && (
        <button title={`Create ${title.toLowerCase().replace('channels', 'channel')}`} onClick={onAdd} className="hover:text-fg">
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

function ChannelRow(p: {
  icon: React.ReactNode;
  name: string;
  active: boolean;
  onClick: () => void;
  onEdit?: () => void;
  suffix?: string;
  unread?: { count: number; mentions: number };
  muted?: boolean;
  sessionMuted?: boolean;
  onToggleMute?: () => void;
}) {
  const silenced = p.muted || p.sessionMuted;
  const hasUnread = !!p.unread?.count && !p.active && !silenced;
  return (
    <div
      className={cx(
        'group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[15px]',
        p.active ? 'bg-hover text-fg' : hasUnread ? 'font-semibold text-fg hover:bg-hover/60' : 'text-muted hover:bg-hover/60 hover:text-fg',
        p.muted && !p.active && 'opacity-50',
      )}
    >
      {hasUnread && <span className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r bg-fg" />}
      <button onClick={p.onClick} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span className="shrink-0 opacity-70">{p.icon}</span>
        <span className="truncate">{p.name}</span>
      </button>
      {!!p.unread?.mentions && !p.active && !silenced && (
        <span className="rounded-full bg-danger px-1.5 text-[11px] leading-4 font-bold text-white">{p.unread.mentions}</span>
      )}
      {p.suffix && <span className="text-xs text-faint">{p.suffix}</span>}
      {p.onToggleMute && (
        <button
          title={p.muted ? 'Unmute channel' : 'Mute channel'}
          onClick={p.onToggleMute}
          className={cx('hover:text-fg max-md:opacity-60', p.muted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
        >
          {p.muted ? <BellOff size={14} /> : <Bell size={14} />}
        </button>
      )}
      {p.onEdit && (
        <button title="Edit channel" onClick={p.onEdit} className="opacity-0 group-hover:opacity-100 hover:text-fg max-md:opacity-60">
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full items-center justify-between rounded px-2.5 py-2 text-left',
        danger ? 'text-danger hover:bg-danger hover:text-white' : 'hover:bg-brand hover:text-white',
      )}
    >
      {children}
      {icon}
    </button>
  );
}
