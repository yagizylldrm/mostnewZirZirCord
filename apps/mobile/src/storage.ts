import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { KeyValueStorage } from '@zirzircord/client-core';

/**
 * Keys holding login tokens live in the OS keychain / keystore instead of plain
 * AsyncStorage. Everything else (preferences, device id…) stays in AsyncStorage.
 */
const SECRET_KEYS = new Set(['zz.accounts', 'zz.tokens']);

// SecureStore values should stay small (Android warns above ~2 KB), and several
// saved accounts can exceed that, so long values are split into chunks.
const CHUNK = 1800;
// SecureStore keys may only contain [A-Za-z0-9._-].
const countKey = (k: string) => `${k}.n`;
const partKey = (k: string, i: number) => `${k}.${i}`;
const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

async function secureGet(k: string): Promise<string | null> {
  const n = Number(await SecureStore.getItemAsync(countKey(k), OPTS));
  if (!n) return null;
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(partKey(k, i), OPTS)));
  return parts.some((p) => p === null) ? null : parts.join('');
}

async function secureRemove(k: string) {
  const n = Number(await SecureStore.getItemAsync(countKey(k), OPTS)) || 0;
  await SecureStore.deleteItemAsync(countKey(k), OPTS);
  await Promise.all(Array.from({ length: n }, (_, i) => SecureStore.deleteItemAsync(partKey(k, i), OPTS)));
}

async function secureSet(k: string, v: string) {
  const old = Number(await SecureStore.getItemAsync(countKey(k), OPTS)) || 0;
  const parts = v.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
  for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(partKey(k, i), parts[i], OPTS);
  await SecureStore.setItemAsync(countKey(k), String(parts.length), OPTS);
  for (let i = parts.length; i < old; i++) await SecureStore.deleteItemAsync(partKey(k, i), OPTS);
}

export const storage: KeyValueStorage = {
  async get(k) {
    if (!SECRET_KEYS.has(k)) return AsyncStorage.getItem(k);
    const v = await secureGet(k);
    if (v !== null) return v;
    // One-time move of tokens saved by older versions out of plain storage.
    const legacy = await AsyncStorage.getItem(k);
    if (legacy !== null) {
      await secureSet(k, legacy);
      await AsyncStorage.removeItem(k);
    }
    return legacy;
  },
  async set(k, v) {
    if (!SECRET_KEYS.has(k)) return AsyncStorage.setItem(k, v);
    await secureSet(k, v);
  },
  async remove(k) {
    if (!SECRET_KEYS.has(k)) return AsyncStorage.removeItem(k);
    await secureRemove(k);
    await AsyncStorage.removeItem(k);
  },
};
