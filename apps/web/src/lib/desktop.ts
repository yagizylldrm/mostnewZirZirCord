/** Bridge exposed by the desktop shell (undefined in the browser). Electron injects
 *  `window.zirzirDesktop` from its preload; the Tauri shell is adapted below. */
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string | null;
  isScreen: boolean;
}

export interface DesktopBridge {
  platform: string;
  apiUrl?: string;
  onScreenPickerRequest(cb: (sources: ScreenSource[]) => void): () => void;
  chooseScreenSource(id: string | null, withAudio: boolean): void;
  setPttKey(code: string | null): void;
  onPtt(cb: (pressed: boolean) => void): () => void;
  onDeepLink(cb: (code: string) => void): () => void;
  setBadge(count: number): void;
}

/** Minimal shape of `window.__TAURI__` (enabled via `withGlobalTauri`). */
interface TauriGlobal {
  core: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
  event: { listen<T>(name: string, cb: (e: { payload: T }) => void): Promise<() => void> };
}

declare global {
  interface Window {
    zirzirDesktop?: DesktopBridge;
    __TAURI__?: TauriGlobal;
  }
}

function tauriPlatform(): string {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'darwin';
  if (/Windows/i.test(ua)) return 'win32';
  return 'linux';
}

function createTauriBridge(t: TauriGlobal): DesktopBridge {
  const on = <T>(name: string, cb: (payload: T) => void) => {
    const un = t.event.listen<T>(name, (e) => cb(e.payload));
    return () => void un.then((f) => f());
  };
  const call = (cmd: string, args?: Record<string, unknown>) => void t.core.invoke(cmd, args).catch(() => {});
  return {
    platform: tauriPlatform(),
    // Screen sharing has no native picker in the Tauri shell yet.
    onScreenPickerRequest: () => () => {},
    chooseScreenSource: () => {},
    setPttKey: (code) => call('set_ptt_key', { code }),
    onPtt: (cb) => on<boolean>('ptt', cb),
    onDeepLink: (cb) => on<string>('deep-link', cb),
    setBadge: (count) => call('set_badge', { count: Math.max(0, Math.floor(count)) }),
  };
}

export const desktop: DesktopBridge | undefined =
  typeof window === 'undefined'
    ? undefined
    : (window.zirzirDesktop ?? (window.__TAURI__ ? createTauriBridge(window.__TAURI__) : undefined));
