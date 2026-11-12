/** Bridge exposed by the Electron preload script (undefined in the browser). */
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

declare global {
  interface Window {
    zirzirDesktop?: DesktopBridge;
  }
}

export const desktop = typeof window !== 'undefined' ? window.zirzirDesktop : undefined;
