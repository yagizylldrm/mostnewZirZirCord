import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Settings, Signal, Video } from 'lucide-react';
import { useState } from 'react';
import { call, openModal, ui, useApp, useCall } from '../lib/zz';
import { AccountMenu } from './AccountMenu';
import { Avatar, IconButton, cx } from './ui';

export function UserPanel() {
  const me = useApp((s) => s.me!);
  const c = useCall((c) => ({
    status: c.status,
    mic: c.micEnabled,
    deaf: c.deafened,
    ptt: c.pttMode,
    pttPressed: c.pttPressed,
    sessionId: c.sessionId,
    channelId: c.channelId,
    screen: c.screenSharing,
    cam: c.cameraEnabled,
    needsUnlock: c.needsAudioUnlock,
    micError: c.micError,
    serverMuted: c.serverMuted,
  }));
  const [menu, setMenu] = useState(false);
  const channelName = useApp((s) =>
    c.sessionId ? s.sessions[c.sessionId]?.channels.find((ch) => ch.id === c.channelId)?.name : undefined,
  );
  const sessionName = useApp((s) => (c.sessionId ? s.sessions[c.sessionId]?.session.name : undefined));

  return (
    <div className="safe-bottom bg-rail/60">
      {c.status !== 'idle' && (
        <div className="space-y-2 border-b border-black/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Signal size={16} className={c.status === 'connected' ? 'text-ok' : 'text-warn'} />
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => c.sessionId && ui.setState((u) => ({ callView: { ...u.callView, [c.sessionId!]: true } }))}
            >
              <div className={cx('text-sm font-semibold', c.status === 'connected' ? 'text-ok' : 'text-warn')}>
                {c.status === 'connected' ? 'Voice connected' : c.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
              </div>
              <div className="truncate text-xs text-muted">
                {channelName} / {sessionName}
              </div>
            </button>
            <IconButton label="Disconnect" danger onClick={() => call.leave()}>
              <PhoneOff size={18} />
            </IconButton>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => call.toggleCamera()}
              className={cx('flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs', c.cam ? 'bg-ok/20 text-ok' : 'bg-field hover:bg-line')}
            >
              <Video size={15} /> Camera
            </button>
            <button
              onClick={() => call.toggleScreenShare()}
              className={cx('flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs', c.screen ? 'bg-ok/20 text-ok' : 'bg-field hover:bg-line')}
            >
              <MonitorUp size={15} /> {c.screen ? 'Sharing' : 'Screen'}
            </button>
          </div>
          {c.serverMuted && (
            <div className="rounded-md bg-danger/15 px-2 py-1.5 text-xs text-danger">🔇 A moderator muted you in this session.</div>
          )}
          {c.micError && (
            <button onClick={() => call.toggleMic()} className="w-full rounded-md bg-warn/15 px-2 py-1.5 text-left text-xs text-warn">
              🎙️ Mic not working — listening only. Tap to retry.
            </button>
          )}
          {c.needsUnlock && (
            <button onClick={() => call.unlockAudio()} className="w-full rounded-md bg-warn py-1.5 text-xs font-semibold text-black">
              Click to enable audio
            </button>
          )}
        </div>
      )}
      <div className="relative flex items-center gap-2 px-2 py-2">
        {menu && <AccountMenu onClose={() => setMenu(false)} />}
        <button className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left hover:bg-hover" onClick={() => setMenu((m) => !m)} title="Account, status, switch account, log out">
          <Avatar name={me.displayName} url={me.avatarUrl} staticUrl={me.avatarStaticUrl} size={32} status={me.status} speaking={c.ptt && c.pttPressed} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{me.displayName}</div>
            <div className="truncate font-mono text-[11px] text-muted">{me.publicId}</div>
          </div>
        </button>
        <IconButton label={c.serverMuted ? 'Muted by a moderator' : c.mic ? 'Mute' : 'Unmute'} danger={!c.mic} disabled={c.serverMuted} onClick={() => call.toggleMic()}>
          {c.mic ? <Mic size={18} /> : <MicOff size={18} />}
        </IconButton>
        <IconButton label={c.deaf ? 'Undeafen' : 'Deafen'} danger={c.deaf} onClick={() => call.toggleDeafen()}>
          {c.deaf ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        </IconButton>
        <IconButton label="Settings" onClick={() => openModal({ type: 'userSettings' })}>
          <Settings size={18} />
        </IconButton>
      </div>
    </div>
  );
}
