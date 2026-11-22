import { can, canModerate, SCREEN_PRESETS, type ScreenPreset } from '@zirzircord/shared';
import { type CallParticipant, MAX_USER_VOLUME } from '@zirzircord/client-core';
import {
  ChevronUp,
  Expand,
  Headphones,
  HeadphoneOff,
  LayoutGrid,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  Shrink,
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

function Tile({ p, sessionId, big, onFocus }: { p: CallParticipant; sessionId: string; big?: boolean; onFocus?: () => void }) {
  const view = useApp((s) => s.sessions[sessionId]);
  const member = view?.members[p.id];
  const [menu, setMenu] = useState(false);
  const channelId = useCall((c) => c.channelId)!;
  const canMod = !p.isLocal && canModerate(view?.myRole, member?.role) && can(view?.myRole, 'voice.serverMute');
  const name = member?.nickname || member?.user.displayName || p.name;

  return (
    <div
      className={cx('group relative overflow-hidden rounded-xl bg-side', p.speaking && 'ring-2 ring-ok', big ? 'size-full' : 'aspect-video', onFocus && 'cursor-pointer')}
      onClick={onFocus}
      title={onFocus ? 'Click to enlarge' : undefined}
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
        {p.userMuted && <VolumeX size={14} className="text-danger" aria-label="Muted by you" />}
        {(p.micMuted || p.serverMuted) && <MicOff size={14} className="text-danger" aria-label={p.serverMuted ? 'Muted by a moderator' : 'Muted'} />}
        {p.serverMuted && <span className="text-[10px] font-bold text-danger">MOD MUTED</span>}
        <span className="max-w-40 truncate">{name}</span>
        <Wifi size={12} className={qualityColor[p.quality]} />
      </div>
      {!p.isLocal && (
        <button
          onClick={(e) => (e.stopPropagation(), setMenu((m) => !m))}
          className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 opacity-0 group-hover:opacity-100 max-md:opacity-100"
          aria-label="Participant options"
        >
          <Volume2 size={14} />
        </button>
      )}
      {menu && !p.isLocal && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute top-10 right-2 z-20 w-56 space-y-2 rounded-lg bg-elev p-3 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-hover" onClick={() => call.setUserMuted(p.id, !p.userMuted)}>
              {p.userMuted ? 'Unmute for me' : 'Mute for me'}
              {p.userMuted ? <VolumeX size={14} className="text-danger" /> : <Volume2 size={14} />}
            </button>
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
            {p.screenHasAudio && (
              <label className="block text-xs text-muted">
                Stream volume · {Math.round((p.screenAudioMuted ? 0 : p.screenVolume) * 100)}%
                <input
                  type="range"
                  min={0}
                  max={MAX_USER_VOLUME}
                  step={0.05}
                  value={p.screenAudioMuted ? 0 : p.screenVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    call.setScreenVolume(p.id, v);
                    if (p.screenAudioMuted && v > 0) call.setScreenAudioMuted(p.id, false);
                  }}
                  className="mt-1 w-full accent-brand"
                />
              </label>
            )}
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

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** Fullscreen for one element, with a toggle (the Fullscreen API only exits via exitFullscreen, not by asking again). */
function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => {
      const d = document as FsDoc;
      setFull((d.fullscreenElement ?? d.webkitFullscreenElement) === ref.current && !!ref.current);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [ref]);
  const toggle = () => {
    const d = document as FsDoc;
    const el = ref.current as FsEl | null;
    if (d.fullscreenElement ?? d.webkitFullscreenElement) void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else if (el) void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
  };
  return { full, toggle };
}

type StreamSource = 'screen' | 'camera';
interface Stream {
  key: string;
  id: string;
  source: StreamSource;
}
const streamKey = (id: string, source: StreamSource) => `${source}:${id}`;

/** Mute button plus a volume slider that slides out on hover (Discord style) for someone's screen-share sound. */
function StreamVolume({ p }: { p: CallParticipant }) {
  if (p.isLocal || !p.screenHasAudio) return null;
  const level = p.screenAudioMuted ? 0 : p.screenVolume;
  const label = level === 0 ? 'Unmute stream sound' : 'Mute stream sound';
  return (
    <div className="group/vol flex items-center rounded-md bg-black/60 focus-within:bg-black/80 hover:bg-black/80">
      <button onClick={() => call.setScreenAudioMuted(p.id, level !== 0)} className="rounded-md p-1.5" aria-label={label} title={label}>
        {level === 0 ? <VolumeX size={16} className="text-danger" /> : <Volume2 size={16} />}
      </button>
      <input
        type="range"
        aria-label="Stream volume"
        min={0}
        max={MAX_USER_VOLUME}
        step={0.05}
        value={level}
        onChange={(e) => {
          const v = Number(e.target.value);
          call.setScreenVolume(p.id, v);
          if (p.screenAudioMuted && v > 0) call.setScreenAudioMuted(p.id, false);
        }}
        className="w-0 opacity-0 accent-brand transition-all group-hover/vol:mr-2 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:mr-2 focus:w-20 focus:opacity-100"
      />
    </div>
  );
}

/** The big picture: someone's screen share or camera, with Discord-style controls on hover. */
function Stage({
  p,
  source,
  sessionId,
  full,
  onFullscreen,
  onUnfocus,
}: {
  p: CallParticipant;
  source: StreamSource;
  sessionId: string;
  full: boolean;
  onFullscreen: () => void;
  onUnfocus?: () => void;
}) {
  const view = useApp((s) => s.sessions[sessionId]);
  const member = view?.members[p.id];
  const name = member?.nickname || member?.user.displayName || p.name;
  const btn = 'rounded-md bg-black/60 p-1.5 hover:bg-black/80';
  return (
    <div className="group relative size-full overflow-hidden rounded-xl bg-black">
      <div className="size-full" onDoubleClick={onFullscreen}>
        <VideoEl identity={p.id} source={source} contain />
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-sm">
        {source === 'screen' ? (
          <>
            <MonitorUp size={14} className="text-ok" /> {p.isLocal ? 'Your screen' : `${name}'s screen`}
            {p.screenAudioMuted && <VolumeX size={14} className="text-danger" aria-label="Stream sound muted" />}
          </>
        ) : (
          <>
            <Video size={14} className="text-ok" /> {p.isLocal ? 'Your camera' : `${name}'s camera`}
          </>
        )}
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        {source === 'screen' && <StreamVolume p={p} />}
        {onUnfocus && (
          <button onClick={onUnfocus} className={btn} aria-label="Show everyone" title="Show everyone">
            <LayoutGrid size={16} />
          </button>
        )}
        {source === 'screen' && !full && (
          <button onClick={() => minimizeScreen(sessionId, p.id)} className={btn} aria-label="Minimize" title="Minimize (keep watching over the chat)">
            <Minimize2 size={16} />
          </button>
        )}
        <button onClick={onFullscreen} className={btn} aria-label={full ? 'Exit fullscreen' : 'Fullscreen'} title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
          {full ? <Shrink size={16} /> : <Expand size={16} />}
        </button>
      </div>
    </div>
  );
}

/** Shows the call controls when the pointer nears the bottom, while a menu is open, while they hold focus, and briefly on entry. */
function useControlsVisible(host: React.RefObject<HTMLElement | null>, hold: boolean, active: boolean) {
  const [near, setNear] = useState(false);
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 3500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const el = host.current; // only exists once the call view is showing
    if (!active || !el) return;
    const move = (e: PointerEvent) => setNear(e.clientY > el.getBoundingClientRect().bottom - 120);
    const leave = () => setNear(false);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [host, active]);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return near || hold || intro || touch;
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
  const root = useRef<HTMLDivElement>(null);
  const { full, toggle: toggleFullscreen } = useFullscreen(root);
  // Which stream is on the stage: the one I picked, else the first screen share. null + no share = the grid.
  const [focus, setFocus] = useState<string | null>(null);
  const [presetMenu, setPresetMenu] = useState(false);
  const inThisSession = c.sessionId === sessionId && c.status !== 'idle';
  const channel = channels.find((ch) => ch.id === c.channelId);
  const streams = useMemo<Stream[]>(
    () => [
      ...c.participants.filter((p) => p.screenSharing).map((p) => ({ key: streamKey(p.id, 'screen'), id: p.id, source: 'screen' as const })),
      ...c.participants.filter((p) => p.cameraOn).map((p) => ({ key: streamKey(p.id, 'camera'), id: p.id, source: 'camera' as const })),
    ],
    [c.participants],
  );
  const staged = streams.find((st) => st.key === focus) ?? (focus === null ? streams.find((st) => st.source === 'screen') : undefined);
  const stagedP = staged && c.participants.find((p) => p.id === staged.id);
  // My pick vanished (camera off, share ended): go back to automatic.
  useEffect(() => {
    if (focus && !streams.some((st) => st.key === focus)) setFocus(null);
  }, [focus, streams]);
  // Opening the call view brings a minimized stream back onto the stage.
  const mini = useUi((u) => u.miniScreen);
  useEffect(() => {
    if (mini?.sessionId !== sessionId) return;
    setFocus(streamKey(mini.identity, 'screen'));
    ui.setState({ miniScreen: null });
  }, [mini, sessionId]);
  const controlsVisible = useControlsVisible(root, presetMenu, inThisSession);

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
    <div ref={root} className="relative flex min-h-0 flex-1 flex-col bg-rail">
      {!full && (
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
      )}

      {!full && c.serverMuted && (
        <div className="mx-3 flex items-center gap-3 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          <MicOff size={18} className="shrink-0" />
          <span>A moderator muted you in this session. You can still listen; only a moderator can unmute you.</span>
        </div>
      )}
      {!full && c.micError && (
        <div className="mx-3 flex items-center gap-3 rounded-lg bg-warn/15 px-3 py-2 text-sm text-warn">
          <MicOff size={18} className="shrink-0" />
          <span className="flex-1">{c.micError} You can still hear everyone.</span>
          <button className="shrink-0 rounded-md bg-warn px-3 py-1 font-semibold text-black" onClick={() => call.toggleMic()}>
            Try again
          </button>
        </div>
      )}
      <div className={cx('flex min-h-0 flex-1 flex-col gap-3', full ? 'p-0' : 'p-3')}>
        {staged && stagedP ? (
          <>
            <div className="min-h-0 flex-1">
              <Stage
                p={stagedP}
                source={staged.source}
                sessionId={sessionId}
                full={full}
                onFullscreen={toggleFullscreen}
                onUnfocus={focus !== null ? () => setFocus(null) : undefined}
              />
            </div>
            {!full && (
              <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
                {streams
                  .filter((st) => st.source === 'screen' && st.key !== staged.key)
                  .map((st) => (
                    <button key={st.key} onClick={() => setFocus(st.key)} className="h-full w-48 shrink-0 overflow-hidden rounded-xl" aria-label="Show this screen">
                      <VideoEl identity={st.id} source="screen" contain />
                    </button>
                  ))}
                {c.participants
                  .filter((p) => !(staged.source === 'camera' && p.id === staged.id))
                  .map((p) => (
                    <div key={p.id} className="h-full w-48 shrink-0">
                      <Tile p={p} sessionId={sessionId} onFocus={p.cameraOn ? () => setFocus(streamKey(p.id, 'camera')) : undefined} />
                    </div>
                  ))}
              </div>
            )}
          </>
        ) : (
          <div className="grid min-h-0 flex-1 auto-rows-min content-center gap-3 overflow-y-auto [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
            {c.participants.map((p) => (
              <Tile key={p.id} p={p} sessionId={sessionId} onFocus={p.cameraOn ? () => setFocus(streamKey(p.id, 'camera')) : undefined} />
            ))}
          </div>
        )}
      </div>

      {/* Meet-style bar: floats over the bottom edge and appears when the pointer gets near it. */}
      <div
        className={cx(
          'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-12 transition duration-200 focus-within:translate-y-0 focus-within:opacity-100 safe-bottom',
          controlsVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        )}
      >
        <div className="flex items-center justify-center gap-3 pb-4">
          <div className={cx('flex items-center justify-center gap-3 focus-within:pointer-events-auto', controlsVisible && 'pointer-events-auto')}>
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
        </div>
        {c.ptt && <p className="pb-2 text-center text-xs text-white/80">Push-to-talk is on — hold your key to speak</p>}
      </div>
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
