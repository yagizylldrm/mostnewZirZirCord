import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStorage } from '@zirzircord/client-core';

export const storage: KeyValueStorage = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};
