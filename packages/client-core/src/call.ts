import {
  type AudioProcessorOptions,
  ConnectionQuality,
  DisconnectReason,
  LocalAudioTrack,
  type Participant,
  RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
  type TrackProcessor,
  type VideoTrack,
} from 'livekit-client';
import { createStore } from 'zustand/vanilla';
import { AUDIO_PRESETS, type AudioPreset, SCREEN_PRESETS, type ScreenPreset } from '@zirzircord/shared';
import type { ApiClient } from './api';

export interface CallParticipant {
  id: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  quality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
  volume: number;
  /** Muted by a moderator (not allowed to publish a microphone). */
  serverMuted: boolean;
  /** Their screen share is sending sound. */
  screenHasAudio: boolean;
  /** I muted their screen share's sound (only for me; their voice is unaffected). */
  screenAudioMuted: boolean;
}

export interface CallState {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  sessionId: string | null;
  channelId: string | null;
  audioPreset: AudioPreset;
  micEnabled: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  screenPreset: ScreenPreset;
  screenContentHint: 'detail' | 'motion';
  pttMode: boolean;
  pttPressed: boolean;
  noiseSuppression: 'browser' | 'rnnoise' | 'off';
  participants: CallParticipant[];
  /** Bumped whenever tracks change, so video UIs re-attach. */
  trackVersion: number;
  needsAudioUnlock: boolean;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /** Why the microphone couldn't start (you stay in the call and can listen). */
  micError: string | null;
  /** A moderator removed your right to talk. Mic, push-to-talk and unmute are blocked. */
  serverMuted: boolean;
}

export interface CallManagerOptions {
  /** Web only: optional RNNoise processor factory for the microphone. */
  noiseProcessor?: () => TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>;
  /** Platform hook to attach remote audio (web needs <audio> elements; RN plays natively). */
  attachAudio?: boolean;
  onError?: (message: string) => void;
  onInfo?: (message: string) => void;
  /** UI sound effects (join/leave/connect/disconnect/mute/deafen). */
  onSound?: (event: 'join' | 'leave' | 'connect' | 'disconnect' | 'mute' | 'unmute' | 'deafen' | 'undeafen') => void;
}

const K_PREFS = 'zz.callPrefs';
/** Protocol value of TrackSource.MICROPHONE in LiveKit permission grants. */
const PROTO_MICROPHONE = 2;

/** Whether the server lets this participant publish a microphone. */
function micAllowed(p: Participant): boolean {
  const perms = p.permissions;
  if (!perms) return true;
  if (!perms.canPublish) return false;
  const sources = perms.canPublishSources ?? [];
  return sources.length === 0 || sources.includes(PROTO_MICROPHONE as never);
}

/** Turns getUserMedia failures into something a person can act on. */
export function describeMicError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || /permission|denied|not allowed/i.test(msg)) {
    return 'Microphone is blocked for this site. Allow it (tap the lock icon next to the address → Microphone → Allow), then tap the mic button.';
  }
  if (name === 'NotFoundError' || /not found|no device/i.test(msg)) return 'No microphone was found on this device.';
  if (name === 'NotReadableError' || /could not start|in use|not readable|busy/i.test(msg)) {
    return 'Your microphone is busy (another call or app is using it). Close that app, then tap the mic button.';
  }
  return `Microphone unavailable: ${msg}`;
}
const quality = (q: ConnectionQuality): CallParticipant['quality'] =>
  q === ConnectionQuality.Excellent ? 'excellent' : q === ConnectionQuality.Good ? 'good' : q === ConnectionQuality.Poor ? 'poor' : q === ConnectionQuality.Lost ? 'lost' : 'unknown';

/**
 * Voice/video/screen-share via LiveKit SFU.
 *
 * Quality choices:
 * - Opus with DTX + RED (redundant audio) → robust to packet loss, no robotic/buzzing audio.
 * - WebRTC jitter buffer + PLC on every client (the old raw-UDP design had none).
 * - adaptiveStream + dynacast → each viewer gets the resolution they render; unused layers are paused.
 * - VP9 SVC for screen share with VP8 backup codec for older devices.
 */
/**
 * Highest per-user volume this platform can play. On the web LiveKit plays remote
 * audio through <audio> elements, whose `volume` only accepts 0–1: anything higher
 * throws (WebKit: "IndexSizeError: The index is not in the allowed range") and
 * would abort joining a call. React Native's native volume can boost up to 2×.
 */
export const MAX_USER_VOLUME = typeof navigator !== 'undefined' && navigator.product === 'ReactNative' ? 2 : 1;
/** A saved/requested volume made safe to hand to LiveKit. */
const playableVolume = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), MAX_USER_VOLUME) : 1);

export class CallManager {
  readonly store = createStore<CallState>(() => ({
    status: 'idle',
    sessionId: null,
    channelId: null,
    audioPreset: 'HIGH',
    micEnabled: true,
    deafened: false,
    cameraEnabled: false,
    screenSharing: false,
    screenPreset: 'P1080_30',
    screenContentHint: 'detail',
    pttMode: false,
    pttPressed: false,
    noiseSuppression: 'browser',
    participants: [],
    trackVersion: 0,
    needsAudioUnlock: false,
    inputDeviceId: null,
    outputDeviceId: null,
    micError: null,
    serverMuted: false,
  }));

  room: Room | null = null;
  private volumes = new Map<string, number>();
  private audioEls = new Map<string, HTMLMediaElement[]>();
  /** Identities whose screen-share sound I muted (this call only). */
  private screenMuted = new Set<string>();

  constructor(
    private api: ApiClient,
    private opts: CallManagerOptions = {},
    private storage?: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> },
  ) {
    this.loadPrefs();
  }

  get state() {
    return this.store.getState();
  }
  private set(p: Partial<CallState>) {
    this.store.setState(p);
  }

  private async loadPrefs() {
    const raw = await this.storage?.get(K_PREFS).catch(() => null);
    if (!raw) return;
    try {
      const p = JSON.parse(raw);
      this.set({
        pttMode: !!p.pttMode,
        noiseSuppression: p.noiseSuppression ?? 'browser',
        screenPreset: p.screenPreset ?? 'P1080_30',
        inputDeviceId: p.inputDeviceId ?? null,
        outputDeviceId: p.outputDeviceId ?? null,
      });
      for (const [k, v] of Object.entries(p.volumes ?? {})) this.volumes.set(k, v as number);
    } catch {}
  }
  private savePrefs() {
    const s = this.state;
    this.storage
      ?.set(
        K_PREFS,
        JSON.stringify({
          pttMode: s.pttMode,
          noiseSuppression: s.noiseSuppression,
          screenPreset: s.screenPreset,
          inputDeviceId: s.inputDeviceId,
          outputDeviceId: s.outputDeviceId,
          volumes: Object.fromEntries(this.volumes),
        }),
      )
      .catch(() => {});
  }

  private error(msg: string) {
    this.opts.onError?.(msg);
  }

  // ------------------------------------------------------------------ join

  async join(sessionId: string, channelId: string) {
    if (this.state.channelId === channelId && this.state.status !== 'idle') return;
    await this.leave();
    this.set({ status: 'connecting', sessionId, channelId, screenSharing: false, cameraEnabled: false });
    try {
      const { url, token, audioPreset } = await this.api.voiceToken(channelId);
      const preset = AUDIO_PRESETS[audioPreset];
      const ns = this.state.noiseSuppression;
      const music = preset.music;
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        audioCaptureDefaults: {
          echoCancellation: !music,
          noiseSuppression: !music && ns === 'browser',
          autoGainControl: !music,
          channelCount: preset.stereo ? 2 : 1,
          deviceId: this.state.inputDeviceId ?? undefined,
        },
        audioOutput: this.state.outputDeviceId ? { deviceId: this.state.outputDeviceId } : undefined,
        publishDefaults: {
          dtx: !music,
          red: true,
          forceStereo: preset.stereo,
          audioPreset: { maxBitrate: preset.maxBitrate },
          videoCodec: 'vp9',
          backupCodec: { codec: 'vp8' },
        },
      });
      this.room = room;
      this.set({ audioPreset });
      this.wire(room);
      await room.connect(url, token, { autoSubscribe: true });
      this.set({ status: 'connected' });
      this.opts.onSound?.('connect');
      await room.startAudio().catch(() => this.set({ needsAudioUnlock: true }));
      this.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.error(`Could not join voice: ${msg}`);
      await this.leave();
      return;
    }
    // Server-muted members join listen-only; nothing they do can publish a mic.
    if (!micAllowed(this.room!.localParticipant)) {
      this.wasMicEnabled = this.state.micEnabled;
      this.set({ serverMuted: true, micEnabled: false });
      this.refresh();
      return;
    }
    // A microphone problem must never throw you out of the call: you stay in and can listen.
    await this.publishMic();
  }

  private wasMicEnabled = true;

  /** Starts (or retries) the microphone. Returns false if it couldn't, leaving you in the call listen-only. */
  private async publishMic(): Promise<boolean> {
    const room = this.room;
    if (!room || this.state.serverMuted) return false;
    const tryEnable = () => room.localParticipant.setMicrophoneEnabled(true);
    try {
      try {
        await tryEnable();
      } catch (e) {
        // A saved device that no longer exists (unplugged headset, new phone) → fall back to the default mic.
        if (!this.state.inputDeviceId) throw e;
        this.set({ inputDeviceId: null });
        this.savePrefs();
        room.options.audioCaptureDefaults = { ...room.options.audioCaptureDefaults, deviceId: undefined };
        await tryEnable();
      }
      if (this.room !== room) return false;
      this.set({ micError: null });
      await this.applyNoiseProcessor();
      if (!this.shouldTransmit()) await this.muteMicTrack(true);
      this.refresh();
      return true;
    } catch (e) {
      if (this.room !== room) return false;
      this.set({ micEnabled: false, micError: describeMicError(e) });
      this.refresh();
      return false;
    }
  }

  async leave() {
    const room = this.room;
    this.room = null;
    if (room && this.state.status !== 'idle' && this.state.status !== 'connecting') this.opts.onSound?.('disconnect');
    if (room) {
      room.removeAllListeners();
      await room.disconnect().catch(() => {});
    }
    for (const els of this.audioEls.values()) els.forEach((el) => el.remove());
    this.audioEls.clear();
    this.screenMuted.clear();
    this.set({
      status: 'idle',
      sessionId: null,
      channelId: null,
      participants: [],
      screenSharing: false,
      cameraEnabled: false,
      needsAudioUnlock: false,
      micError: null,
      serverMuted: false,
      trackVersion: this.state.trackVersion + 1,
    });
  }

  async unlockAudio() {
    await this.room?.startAudio();
    this.set({ needsAudioUnlock: false });
  }

  // ---------------------------------------------------------------- events

  private wire(room: Room) {
    const refresh = () => this.refresh();
    const bump = () => this.set({ trackVersion: this.state.trackVersion + 1 });
    room
      .on(RoomEvent.ParticipantConnected, () => {
        this.opts.onSound?.('join');
        refresh();
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        this.detachAudio(p.identity);
        this.opts.onSound?.('leave');
        refresh();
      })
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
        if (p.isLocal && this.room === room) this.onLocalPermissions();
        refresh();
      })
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.ConnectionQualityChanged, refresh)
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (track.kind === Track.Kind.Audio) this.attachAudio(track as RemoteTrack, p);
        bump();
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, p) => {
        if (track.kind === Track.Kind.Audio) this.detachAudio(p.identity, track as RemoteTrack);
        bump();
        refresh();
      })
      .on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) this.set({ screenSharing: true });
        bump();
        refresh();
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.ScreenShare) this.set({ screenSharing: false });
        if (pub.source === Track.Source.Camera) this.set({ cameraEnabled: false });
        bump();
        refresh();
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.set({ needsAudioUnlock: !room.canPlaybackAudio }))
      .on(RoomEvent.Reconnecting, () => this.set({ status: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => this.set({ status: 'connected' }))
      .on(RoomEvent.MediaDevicesError, () => {
        /* surfaced through micError / camera & screen handlers */
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (this.room !== room) return;
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) this.error('You were removed from the voice channel');
        else if (reason === DisconnectReason.ROOM_DELETED) this.error('The voice channel was closed');
        this.leave();
      });
  }

  /** Volume for someone's voice: their user volume, or 0 while deafened. */
  private voiceVolume(identity: string) {
    return this.state.deafened ? 0 : playableVolume(this.volumes.get(identity) ?? 1);
  }

  /** Screen-share sound follows the user volume, unless I muted that stream. */
  private screenVolume(identity: string) {
    return this.screenMuted.has(identity) ? 0 : this.voiceVolume(identity);
  }

  private applyVolumes(p: RemoteParticipant) {
    p.setVolume(this.voiceVolume(p.identity), Track.Source.Microphone);
    p.setVolume(this.screenVolume(p.identity), Track.Source.ScreenShareAudio);
  }

  /** Mutes / unmutes the sound of someone's screen share, for me only. */
  setScreenAudioMuted(identity: string, muted: boolean) {
    if (muted) this.screenMuted.add(identity);
    else this.screenMuted.delete(identity);
    const p = this.room?.remoteParticipants.get(identity);
    if (p) p.setVolume(this.screenVolume(identity), Track.Source.ScreenShareAudio);
    this.refresh();
  }

  private attachAudio(track: RemoteTrack, p: RemoteParticipant) {
    if (track instanceof RemoteAudioTrack) {
      if (track.source === Track.Source.ScreenShareAudio) p.setVolume(this.screenVolume(p.identity), Track.Source.ScreenShareAudio);
      else p.setVolume(this.voiceVolume(p.identity), Track.Source.Microphone);
    }
    if (this.opts.attachAudio === false || typeof document === 'undefined') return;
    const el = track.attach();
    el.style.display = 'none';
    document.body.appendChild(el);
    this.audioEls.set(p.identity, [...(this.audioEls.get(p.identity) ?? []), el]);
  }

  private detachAudio(identity: string, track?: RemoteTrack) {
    if (track) track.detach().forEach((el) => el.remove());
    else {
      this.audioEls.get(identity)?.forEach((el) => el.remove());
      this.audioEls.delete(identity);
    }
  }

  /** A moderator muted or unmuted us (LiveKit already unpublished/blocks the mic). */
  private async onLocalPermissions() {
    const room = this.room;
    if (!room) return;
    const allowed = micAllowed(room.localParticipant);
    if (!allowed && !this.state.serverMuted) {
      this.wasMicEnabled = this.state.micEnabled;
      this.set({ serverMuted: true, micEnabled: false, micError: null, pttPressed: false });
      this.error('A moderator muted you in this session');
    } else if (allowed && this.state.serverMuted) {
      this.set({ serverMuted: false, micEnabled: this.wasMicEnabled });
      (this.opts.onInfo ?? this.opts.onError)?.('A moderator unmuted you');
      if (this.wasMicEnabled) await this.publishMic();
    }
  }

  private refresh() {
    const room = this.room;
    if (!room) return this.set({ participants: [] });
    const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const participants = all.map<CallParticipant>((p) => ({
      id: p.identity,
      name: p.name || p.identity,
      isLocal: p.isLocal,
      speaking: p.isSpeaking,
      micMuted: !p.isMicrophoneEnabled,
      cameraOn: p.isCameraEnabled,
      screenSharing: p.isScreenShareEnabled,
      quality: quality(p.connectionQuality),
      volume: playableVolume(this.volumes.get(p.identity) ?? 1),
      serverMuted: !micAllowed(p),
      screenHasAudio: !!p.getTrackPublication(Track.Source.ScreenShareAudio),
      screenAudioMuted: this.screenMuted.has(p.identity),
    }));
    this.set({ participants });
  }

  // ------------------------------------------------------------ microphone

  private async muteMicTrack(muted: boolean) {
    const pub = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub?.track) return;
    if (muted) await pub.mute();
    else await pub.unmute();
    this.refresh();
  }

  private shouldTransmit() {
    const s = this.state;
    return s.micEnabled && !s.deafened && (!s.pttMode || s.pttPressed);
  }

  async toggleMic() {
    if (this.state.serverMuted) return this.error('A moderator muted you. Only a moderator can unmute you.');
    const enable = !this.state.micEnabled;
    this.set({ micEnabled: enable });
    this.opts.onSound?.(enable ? 'unmute' : 'mute');
    // Mic never started (blocked/busy earlier)? Try again now — this click also re-prompts for permission.
    if (enable && this.room && !this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track) {
      if (!(await this.publishMic())) return;
    }
    if (enable && this.state.deafened) return this.setDeafened(false); // unmuting also undeafens
    await this.muteMicTrack(!this.shouldTransmit());
  }

  async toggleDeafen() {
    const deafen = !this.state.deafened;
    this.opts.onSound?.(deafen ? 'deafen' : 'undeafen');
    await this.setDeafened(deafen);
  }

  private async setDeafened(deafened: boolean) {
    this.set({ deafened });
    for (const p of this.room?.remoteParticipants.values() ?? []) this.applyVolumes(p);
    await this.muteMicTrack(!this.shouldTransmit());
  }

  /** Push-to-talk: call with true on key down and false on key up. */
  async setPttPressed(pressed: boolean) {
    if (this.state.serverMuted) return; // push-to-talk can't bypass a moderator mute
    if (!this.state.pttMode || this.state.pttPressed === pressed) return;
    this.set({ pttPressed: pressed });
    await this.muteMicTrack(!this.shouldTransmit());
  }

  async setPttMode(on: boolean) {
    this.set({ pttMode: on, pttPressed: false });
    this.savePrefs();
    await this.muteMicTrack(!this.shouldTransmit());
  }

  setUserVolume(identity: string, requested: number) {
    const volume = playableVolume(requested);
    this.volumes.set(identity, volume);
    this.savePrefs();
    const p = this.room?.remoteParticipants.get(identity);
    if (p) this.applyVolumes(p);
    this.refresh();
  }

  async setNoiseSuppression(mode: CallState['noiseSuppression']) {
    this.set({ noiseSuppression: mode });
    this.savePrefs();
    const pub = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track;
    if (!(track instanceof LocalAudioTrack)) return;
    await track.restartTrack({
      echoCancellation: !AUDIO_PRESETS[this.state.audioPreset].music,
      noiseSuppression: mode === 'browser',
      autoGainControl: !AUDIO_PRESETS[this.state.audioPreset].music,
      deviceId: this.state.inputDeviceId ?? undefined,
    });
    await this.applyNoiseProcessor();
  }

  private async applyNoiseProcessor() {
    const track = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!(track instanceof LocalAudioTrack)) return;
    try {
      if (this.state.noiseSuppression === 'rnnoise' && this.opts.noiseProcessor && !AUDIO_PRESETS[this.state.audioPreset].music) {
        // RNNoise runs at 48 kHz inside an AudioWorklet.
        if (!(track as any).audioContext && typeof AudioContext !== 'undefined') {
          await track.setAudioContext(new AudioContext({ sampleRate: 48000 }));
        }
        await track.setProcessor(this.opts.noiseProcessor());
      } else if (track.getProcessor()) {
        await track.stopProcessor();
      }
    } catch (e) {
      this.error('Noise suppression unavailable on this device');
    }
  }

  async setDevice(kind: 'audioinput' | 'audiooutput', deviceId: string) {
    if (kind === 'audioinput') this.set({ inputDeviceId: deviceId });
    else this.set({ outputDeviceId: deviceId });
    this.savePrefs();
    await this.room?.switchActiveDevice(kind, deviceId).catch((e) => this.error(`Could not switch device: ${e.message}`));
  }

  // ------------------------------------------------------- screen + camera

  setScreenPreset(preset: ScreenPreset, contentHint?: 'detail' | 'motion') {
    this.set({ screenPreset: preset, ...(contentHint ? { screenContentHint: contentHint } : {}) });
    this.savePrefs();
  }

  async toggleScreenShare() {
    const room = this.room;
    if (!room) return;
    const enable = !this.state.screenSharing;
    const p = SCREEN_PRESETS[this.state.screenPreset];
    try {
      await room.localParticipant.setScreenShareEnabled(
        enable,
        {
          // restrictOwnAudio: capture the computer's sound EXCEPT ZirZirCord's own playback,
          // so the call's voices aren't sent back into the call (doubled voices / echo).
          // Chrome/Edge and the Electron desktop app (→ "loopbackWithoutChrome") support it.
          audio: { restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          suppressLocalAudioPlayback: true,
          contentHint: this.state.screenContentHint,
          resolution: { width: p.width, height: p.height, frameRate: p.fps },
        },
        {
          videoCodec: 'vp9',
          backupCodec: { codec: 'vp8' },
          screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.fps, priority: 'high' },
          degradationPreference: this.state.screenContentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
        },
      );
      this.set({ screenSharing: enable && room.localParticipant.isScreenShareEnabled });
      if (enable) await this.guardScreenAudioEcho();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/NotAllowed|Permission|cancel/i.test(msg)) this.error(`Screen share failed: ${msg}`);
      this.set({ screenSharing: false });
    }
  }

  /**
   * Safety net: if the browser could not exclude our own call audio from the
   * captured screen sound, don't send screen sound at all — otherwise everyone
   * would hear the call's voices twice.
   */
  private async guardScreenAudioEcho() {
    const room = this.room;
    const pub = room?.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);
    const track = pub?.track;
    if (!room || !track) return;
    const settings = track.mediaStreamTrack.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean };
    if (settings.restrictOwnAudio === true) return;
    await room.localParticipant.unpublishTrack(track, true).catch(() => {});
    this.error('Screen sound was turned off: this browser can’t keep the call’s voices out of it (they would be heard twice). Use Chrome, Edge or the desktop app to share sound.');
  }

  /** True if the current screen share is sending sound. */
  get screenShareHasAudio() {
    return !!this.room?.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
  }

  async toggleCamera() {
    const room = this.room;
    if (!room) return;
    const enable = !this.state.cameraEnabled;
    try {
      await room.localParticipant.setCameraEnabled(enable, { resolution: { width: 1280, height: 720, frameRate: 30 } });
      this.set({ cameraEnabled: enable });
    } catch (e) {
      this.error(`Camera failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Returns the video track of a participant for rendering. */
  getVideoTrack(identity: string, source: 'screen' | 'camera'): VideoTrack | undefined {
    const room = this.room;
    if (!room) return undefined;
    const p = identity === room.localParticipant.identity ? room.localParticipant : room.remoteParticipants.get(identity);
    const pub = p?.getTrackPublication(source === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera);
    return pub?.track as VideoTrack | undefined;
  }

  /** Lets the UI pause video it doesn't show (saves bandwidth in big calls). */
  setVideoSubscribed(identity: string, source: 'screen' | 'camera', subscribed: boolean) {
    const p = this.room?.remoteParticipants.get(identity);
    const pub = p?.getTrackPublication(source === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera);
    pub?.setSubscribed(subscribed);
  }
}
