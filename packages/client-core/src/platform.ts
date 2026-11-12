/** Things that differ between web, Electron and React Native. */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PlatformConfig {
  apiUrl: string;
  storage: KeyValueStorage;
}

export const webStorage: KeyValueStorage = {
  async get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  async set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  async remove(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

export function randomId(): string {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
