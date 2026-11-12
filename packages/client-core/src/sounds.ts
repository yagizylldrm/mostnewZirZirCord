import { createStore } from 'zustand/vanilla';
import type { KeyValueStorage } from './platform';

export const SOUND_EVENTS = ['join', 'leave', 'connect', 'disconnect', 'message', 'mention', 'mute', 'unmute', 'deafen', 'undeafen'] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** User-facing groups, each with its own on/off switch in settings. */
export const SOUND_GROUPS = {
  join: { label: 'Someone joins your voice channel', events: ['join'], preview: 'join' },
  leave: { label: 'Someone leaves your voice channel', events: ['leave'], preview: 'leave' },
  self: { label: 'You connect / disconnect', events: ['connect', 'disconnect'], preview: 'connect' },
  message: { label: 'New messages', events: ['message'], preview: 'message' },
  mention: { label: 'Pings (@mentions)', events: ['mention'], preview: 'mention' },
  toggles: { label: 'Mute & deafen', events: ['mute', 'unmute', 'deafen', 'undeafen'], preview: 'mute' },
} as const satisfies Record<string, { label: string; events: readonly SoundEvent[]; preview: SoundEvent }>;
export type SoundGroup = keyof typeof SOUND_GROUPS;

export interface SoundPrefs {
  enabled: boolean;
  /** 0..1 */
  volume: number;
  groups: Record<SoundGroup, boolean>;
}

const DEFAULTS: SoundPrefs = {
  enabled: true,
  volume: 0.6,
  groups: { join: true, leave: true, self: true, message: true, mention: true, toggles: true },
};
const K_SOUNDS = 'zz.soundPrefs';

const groupOf = (e: SoundEvent) => (Object.keys(SOUND_GROUPS) as SoundGroup[]).find((g) => (SOUND_GROUPS[g].events as readonly SoundEvent[]).includes(e))!;

/**
 * Decides whether a UI sound should play (master switch, per-sound switches,
 * Do-Not-Disturb) and hands it to the platform's player.
 */
export class SoundManager {
  readonly store = createStore<SoundPrefs>(() => DEFAULTS);
  private lastPlayed = new Map<SoundEvent, number>();

  constructor(
    private storage: KeyValueStorage,
    private player: (event: SoundEvent, volume: number) => void,
    /** Do Not Disturb silences message and mention sounds. */
    private isDnd: () => boolean = () => false,
  ) {
    this.load();
  }

  get prefs() {
    return this.store.getState();
  }

  private async load() {
    try {
      const raw = await this.storage.get(K_SOUNDS);
      if (raw) {
        const p = JSON.parse(raw);
        this.store.setState({ ...DEFAULTS, ...p, groups: { ...DEFAULTS.groups, ...p.groups } });
      }
    } catch {}
  }

  update(partial: Partial<Omit<SoundPrefs, 'groups'>> & { groups?: Partial<SoundPrefs['groups']> }) {
    const cur = this.prefs;
    const next = { ...cur, ...partial, groups: { ...cur.groups, ...partial.groups } };
    this.store.setState(next);
    this.storage.set(K_SOUNDS, JSON.stringify(next)).catch(() => {});
  }

  play(event: SoundEvent) {
    const p = this.prefs;
    if (!p.enabled || p.volume <= 0 || !p.groups[groupOf(event)]) return;
    if ((event === 'message' || event === 'mention') && this.isDnd()) return;
    // Don't machine-gun the same sound (e.g. five people joining at once).
    const now = Date.now();
    if (now - (this.lastPlayed.get(event) ?? 0) < 250) return;
    this.lastPlayed.set(event, now);
    try {
      this.player(event, p.volume);
    } catch {}
  }

  /** Plays a sound from the settings screen regardless of its switch. */
  preview(event: SoundEvent) {
    try {
      this.player(event, this.prefs.volume || 0.6);
    } catch {}
  }
}
