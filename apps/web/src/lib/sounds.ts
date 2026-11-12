import { type SoundEvent, SoundManager, webStorage } from '@zirzircord/client-core';
import { call, setSoundHook, zz } from './zz';

/** Plays the bundled UI sounds on the same output device as the call. */
const cache = new Map<SoundEvent, HTMLAudioElement>();

function player(event: SoundEvent, volume: number) {
  let base = cache.get(event);
  if (!base) {
    base = new Audio(`./sounds/${event}.wav`);
    base.preload = 'auto';
    cache.set(event, base);
  }
  // Clone so overlapping sounds don't cut each other off.
  const el = base.cloneNode(true) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  el.volume = Math.max(0, Math.min(1, volume));
  const sink = call.state.outputDeviceId;
  if (sink && el.setSinkId) el.setSinkId(sink).catch(() => {});
  el.play().catch(() => {
    /* autoplay is blocked until the first click — fine */
  });
}

export const sounds = new SoundManager(webStorage, player, () => zz.state.me?.status === 'DND');
setSoundHook((e) => sounds.play(e));

// Preload so the first sound isn't delayed.
for (const e of ['join', 'leave', 'connect', 'message', 'mention'] as SoundEvent[]) {
  const a = new Audio(`./sounds/${e}.wav`);
  a.preload = 'auto';
  cache.set(e, a);
}
