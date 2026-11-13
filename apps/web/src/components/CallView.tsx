import { can, canModerate, SCREEN_PRESETS, type ScreenPreset } from '@zirzircord/shared';
import { type CallParticipant, MAX_USER_VOLUME } from '@zirzircord/client-core';
import {
  ChevronUp,
  Expand,
  Headphones,
  HeadphoneOff,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { call, ui, useApp, useCall, useUi, zz } from '../lib/zz';
import { Avatar, cx } from './ui';
import { VideoEl } from './VideoEl';

const qualityColor = {
  excellent: 'text-ok',
  good: 'text-ok',
  poor: 'text-warn',
  lost: 'text-danger',
  unknown: 'text-faint',
};

function Tile({ p, sessionId, big }: { p: CallParticipant; sessionId: string; big?: boolean }) {
  const view = useApp((s) => s.sessions[sessionId]);
  const member = view?.members[p.id];
  const [menu, setMenu] = useState(false);
  const channelId = useCall((c) => c.channelId)!;
  const canMod = !p.isLocal && canModerate(view?.myRole, member?.role) && can(view?.myRole, 'voice.serverMute');
  const name = member?.nickname || member?.user.displayName || p.name;

  return (
    <div
      className={cx('group relative overflow-hidden rounded-xl bg-side', p.speaking && 'ring-2 ring-ok', big ? 'size-full' : 'aspect-video')}
      onContextMenu={(e) => (e.preventDefault(), setMenu(true))}
    >
      {p.cameraOn ? (
        <VideoEl identity={p.id} source="camera" />
      ) : (
        <div className="grid size-full place-items-center">
          <Avatar name={name} url={member?.user.avatarUrl} staticUrl={member?.user.avatarStaticUrl} size={big ? 96 : 64} speaking={p.speaking} />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-sm">
        {(p.micMuted || p.serverMuted) && <MicOff size={14} className="text-danger" aria-label={p.serverMuted ? 'Muted by a moderator' : 'Muted'} />}
        {p.serverMuted && <span className="text-[10px] font-bold text-danger">MOD MUTED</span>}
        <span className="max-w-40 truncate">{name}</span>
        <Wifi size={12} className={qualityColor[p.quality]} />
      </div>
      {!p.isLocal && (
        <button
          onClick={() => setMenu((m) => !m)}
          className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 opacity-0 group-hover:opacity-100 max-md:opacity-100"
          aria-label="Participant options"
        >
          <Volume2 size={14} />
        </button>
      )}
      {menu && !p.isLocal && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute top-10 right-2 z-20 w-56 space-y-2 rounded-lg bg-elev p-3 text-sm shadow-xl">
            <label className="block text-xs text-muted">
              User volume · {Math.round(p.volume * 100)}%
              <input
                type="range"
                min={0}
                max={MAX_USER_VOLUME}
                step={0.05}
                value={p.volume}
                onChange={(e) => call.setUserVolume(p.id, Number(e.target.value))}
                className="mt-1 w-full accent-brand"
              />
            </label>
            {canMod && (
              <div className="space-y-1 border-t border-line pt-2">
                <button
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-hover"
                  onClick={() => (setMenu(false), zz.attempt(() => zz.api.serverMute(sessionId, p.id, !member?.serverMuted)))}
                >
                  {member?.serverMuted ? 'Remove server mute' : 'Server mute (in this session)'}
                </button>
                <button
                  className="w-full rounded px-2 py-1.5 text-left text-danger hover:bg-danger hover:text-white"
                  onClick={() => (setMenu(false), zz.attempt(() => zz.api.channelKick(channelId, p.id)))}
                >
                  Disconnect from channel
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Shrinks a screen share into the floating mini player and goes back to chat. */
export function minimizeScreen(sessionId: string, identity: string) {
  ui.setState((u) => ({
    miniScreen: { sessionId, identity },
    callView: { ...u.callView, [sessionId]: false },
  }));
}

/** Mute / unmute a screen share's sound for me only (shown when it carries sound). */
export function ScreenMuteButton({ p, className }: { p: CallParticipant; className?: string }) {
  if (p.isLocal || !p.screenHasAudio) return null;
  const label = p.screenAudioMuted ? 'Unmute stream sound' : 'Mute stream sound';
  return (
    <button onClick={() => call.setScreenAudioMuted(p.id, !p.screenAudioMuted)} className={className} aria-label={label} title={label}>
      {p.screenAudioMuted ? <VolumeX size={16} className="text-danger" /> : <Volume2 size={16} />}
    </button>
  );
}

function ScreenStage({ p, sessionId }: { p: CallParticipant; sessionId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const view = useApp((s) => s.sessions[sessionId]);
  const name = view?.members[p.id]?.nickname || view?.members[p.id]?.user.displayName || p.name;
  const btn = 'rounded-md bg-black/60 p-1.5 hover:bg-black/80';
  return (
    <div ref={ref} className="group relative size-full overflow-hidden rounded-xl bg-black">
      <VideoEl identity={p.id} source="screen" contain />
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-sm">
        <MonitorUp size={14} className="text-ok" /> {p.isLocal ? 'Your screen' : `${name}'s screen`}
        {p.screenAudioMuted && <VolumeX size={14} className="text-danger" aria-label="Stream sound muted" />}
      </div>
      <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 max-md:opacity-100">
        <ScreenMuteButton p={p} className={btn} />
        <button onClick={() => minimizeScreen(sessionId, p.id)} className={btn} aria-label="Minimize" title="Minimize (keep watching over the chat)">
          <Minimize2 size={16} />
        </button>
        <button onClick={() => ref.current?.requestFullscreen?.()} className={btn} aria-label="Fullscreen" title="Fullscreen">
          <Expand size={16} />
        </button>
      </div>
    </div>
  );
}

export function CallView() {
  const sessionId = useApp((s) => s.activeSessionId!);
  const channels = useApp((s) => s.sessions[s.activeSessionId!]?.channels ?? []);
  const c = useCall((c) => ({
    status: c.status,
    channelId: c.channelId,
    sessionId: c.sessionId,
    participants: c.participants,
    mic: c.micEnabled,
    deaf: c.deafened,
    cam: c.cameraEnabled,
    screen: c.screenSharing,
    preset: c.screenPreset,
    hint: c.screenContentHint,
    ptt: c.pttMode,
    micError: c.micError,
    serverMuted: c.serverMuted,
  }));
  const [focus, setFocus] = useState<string | null>(null);
  const [presetMenu, setPresetMenu] = useState(false);
  const inThisSession = c.sessionId === sessionId && c.status !== 'idle';
  const channel = channels.find((ch) => ch.id === c.channelId);
  const sharers = useMemo(() => c.participants.filter((p) => p.screenSharing), [c.participants]);
  const stage = sharers.find((p) => p.id === focus) ?? sharers[0];
  // Opening the call view brings a minimized stream back onto the stage.
  const mini = useUi((u) => u.miniScreen);
  useEffect(() => {
    if (mini?.sessionId !== sessionId) return;
    setFocus(mini.identity);
    ui.setState({ miniScreen: null });
  }, [mini, sessionId]);

  if (!inThisSession) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-muted">You are not in a voice channel in this session.</p>
          <button
            className="rounded-md bg-field px-4 py-2 text-sm"
            onClick={() =>
              ui.setState((u) => ({
                callView: { ...u.callView, [sessionId]: false },
              }))
            }
          >
            Back to chat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-rail">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Volume2 size={20} className="text-muted" />
        <span className="font-semibold">{channel?.name}</span>
        <span className="text-xs text-muted">{c.participants.length} connected</span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-fg"
          onClick={() =>
            ui.setState((u) => ({
              callView: { ...u.callView, [sessionId]: false },
            }))
          }
        >
          <MessageSquare size={16} /> Chat
        </button>
      </header>

      {c.serverMuted && (
        <div className="mx-3 flex items-center gap-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          <MicOff size={18} className="shrink-0" />
          <span>A moderator muted you in this session. You can still listen; only a moderator can unmute you.</span>
        </div>
      )}
      {c.micError && (
        <div className="mx-3 flex items-center gap-3 rounded-lg bg-warn/15 px-3 py-2 text-sm text-warn">
          <MicOff size={18} className="shrink-0" />
          <span className="flex-1">{c.micError} You can still hear everyone.</span>
          <button className="shrink-0 rounded-md bg-warn px-3 py-1 font-semibold text-black" onClick={() => call.toggleMic()}>
            Try again
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {stage ? (
          <>
            <div className="min-h-0 flex-1">
              <ScreenStage p={stage} sessionId={sessionId} />
            </div>
            <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
              {sharers.length > 1 &&
                sharers
                  .filter((p) => p.id !== stage.id)
                  .map((p) => (
                    <button key={`s-${p.id}`} onClick={() => setFocus(p.id)} className="h-full w-48 shrink-0 overflow-hidden rounded-xl">
                      <VideoEl identity={p.id} source="screen" contain />
                    </button>
                  ))}
              {c.participants.map((p) => (
                <div key={p.id} className="h-full w-48 shrink-0">
                  <Tile p={p} sessionId={sessionId} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="grid min-h-0 flex-1 auto-rows-min content-center gap-3 overflow-y-auto [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
            {c.participants.map((p) => (
              <Tile key={p.id} p={p} sessionId={sessionId} />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3 pb-4 safe-bottom">
        <CtrlButton label={c.serverMuted ? 'Muted by a moderator' : c.mic ? 'Mute' : 'Unmute'} off={!c.mic} onClick={() => call.toggleMic()}>
          {c.mic ? <Mic /> : <MicOff />}
        </CtrlButton>
        <CtrlButton label={c.deaf ? 'Undeafen' : 'Deafen'} off={c.deaf} onClick={() => call.toggleDeafen()}>
          {c.deaf ? <HeadphoneOff /> : <Headphones />}
        </CtrlButton>
        <CtrlButton label={c.cam ? 'Turn camera off' : 'Turn camera on'} on={c.cam} onClick={() => call.toggleCamera()}>
          {c.cam ? <Video /> : <VideoOff />}
        </CtrlButton>
        <div className="relative flex">
          <CtrlButton label={c.screen ? 'Stop sharing' : 'Share screen'} on={c.screen} onClick={() => call.toggleScreenShare()}>
            <MonitorUp />
          </CtrlButton>
          <button
            onClick={() => setPresetMenu((m) => !m)}
            className="-ml-2 self-end rounded-full bg-field p-1 text-muted hover:text-fg"
            aria-label="Screen share quality"
          >
            <ChevronUp size={14} />
          </button>
          {presetMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPresetMenu(false)} />
              <div className="absolute bottom-14 left-1/2 z-20 w-60 -translate-x-1/2 space-y-1 rounded-lg bg-elev p-2 text-sm shadow-xl">
                <div className="px-2 py-1 text-xs font-bold text-muted">STREAM QUALITY</div>
                {(Object.keys(SCREEN_PRESETS) as ScreenPreset[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => call.setScreenPreset(k)}
                    className={cx('flex w-full justify-between rounded px-2 py-1.5 hover:bg-hover', c.preset === k && 'text-brand')}
                  >
                    {SCREEN_PRESETS[k].label}
                    {c.preset === k && '✓'}
                  </button>
                ))}
                <div className="px-2 pt-2 pb-1 text-xs font-bold text-muted">OPTIMIZE FOR</div>
                {(['detail', 'motion'] as const).map((h) => (
                  <button
                    key={h}
                    onClick={() => call.setScreenPreset(c.preset, h)}
                    className={cx('flex w-full justify-between rounded px-2 py-1.5 hover:bg-hover', c.hint === h && 'text-brand')}
                  >
                    {h === 'detail' ? 'Text & detail (sharp)' : 'Motion & games (smooth)'}
                    {c.hint === h && '✓'}
                  </button>
                ))}
                <p className="px-2 pt-1 text-[11px] text-faint">Applies the next time you start sharing.</p>
              </div>
            </>
          )}
        </div>
        <CtrlButton label="Disconnect" danger onClick={() => call.leave()}>
          <PhoneOff />
        </CtrlButton>
      </div>
      {c.ptt && <p className="pb-2 text-center text-xs text-muted">Push-to-talk is on — hold your key to speak</p>}
    </div>
  );
}

function CtrlButton({
  label,
  children,
  onClick,
  on,
  off,
  danger,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  on?: boolean;
  off?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'grid size-12 place-items-center rounded-full transition [&_svg]:size-5',
        danger ? 'bg-danger text-white hover:brightness-110' : off ? 'bg-white text-danger' : on ? 'bg-ok text-white' : 'bg-field text-fg hover:bg-line',
      )}
    >
      {children}
    </button>
  );
}
