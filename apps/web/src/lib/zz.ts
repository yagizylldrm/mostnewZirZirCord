import { type AppState, CallManager, type CallState, type SoundEvent, ZirZirClient, webStorage } from '@zirzircord/client-core';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';
import { desktop } from './desktop';
import { createRnnoiseProcessor } from './rnnoise';

function resolveApiUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined;
  if (fromEnv) return fromEnv;
  if (desktop?.apiUrl) return desktop.apiUrl;
  if (location.protocol === 'file:' || !location.hostname) return 'http://localhost:4000';
  // Dev: API runs next to the web server on port 4000. Production: same origin under /api is
  // handled by the reverse proxy (see infra/Caddyfile) — set VITE_API_URL for that build.
  return `${location.protocol}//${location.hostname}:4000`;
}

export const zz = new ZirZirClient({ apiUrl: resolveApiUrl(), storage: webStorage });
export const call = new CallManager(
  zz.api,
  {
    noiseProcessor: createRnnoiseProcessor,
    onError: (m) => zz.notify(m, 'error'),
    onInfo: (m) => zz.notify(m, 'success'),
    onSound: (e) => soundHook(e),
  },
  webStorage,
);
/** Set by lib/sounds.ts (avoids a circular import at module load). */
export let soundHook: (e: SoundEvent) => void = () => {};
export function setSoundHook(fn: typeof soundHook) {
  soundHook = fn;
}
zz.onSound = (e) => soundHook(e);

zz.onSessionGone = (sid) => {
  if (call.state.sessionId === sid) call.leave();
};
zz.onChannelGone = (cid) => {
  if (call.state.channelId === cid) call.leave();
};

export function useApp<T>(sel: (s: AppState) => T): T {
  return useStore(zz.store, useShallow(sel));
}
export function useCall<T>(sel: (s: CallState) => T): T {
  return useStore(call.store, useShallow(sel));
}

// ------------------------------------------------------------------ UI state

export type Modal =
  | { type: 'createSession' }
  | { type: 'joinSession'; code?: string }
  | { type: 'createChannel'; channelType: 'TEXT' | 'VOICE' }
  | { type: 'editChannel'; channelId: string }
  | { type: 'sessionSettings'; tab?: string }
  | { type: 'userSettings'; tab?: string }
  | { type: 'nickname' }
  | { type: 'notifications'; sessionId: string }
  | null;

export interface UiState {
  modal: Modal;
  /** sessionId -> showing the call stage instead of chat */
  callView: Record<string, boolean>;
  membersOpen: boolean;
  drawerOpen: boolean;
  profile: { userId: string; sessionId: string; x: number; y: number } | null;
  lightbox: string | null;
  pttKey: string;
}

export const ui = createStore<UiState>(() => ({
  modal: null,
  callView: {},
  membersOpen: typeof window !== 'undefined' ? window.innerWidth >= 1100 : true,
  drawerOpen: false,
  profile: null,
  lightbox: null,
  pttKey: (() => {
    try {
      return localStorage.getItem('zz.pttKey') ?? 'Backquote';
    } catch {
      return 'Backquote';
    }
  })(),
}));
export function useUi<T>(sel: (s: UiState) => T): T {
  return useStore(ui, useShallow(sel));
}
export const openModal = (modal: Modal) => ui.setState({ modal });
export const closeModal = () => ui.setState({ modal: null });
