import Constants from 'expo-constants';
import { Vibration } from 'react-native';
import { type AppState, CallManager, type CallState, ZirZirClient } from '@zirzircord/client-core';
import { setDndCheck, sounds } from './sounds';
import { storage } from './storage';

export { storage };
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';


const K_SERVER = 'zz.serverUrl';
export const defaultServer: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://localhost:4000';

export let zz: ZirZirClient;
export let call: CallManager;

/** Creates the client for a server URL (users can point the app at their own server). */
export async function initClient(serverOverride?: string) {
  const server = serverOverride ?? (await storage.get(K_SERVER)) ?? defaultServer;
  if (serverOverride) await storage.set(K_SERVER, serverOverride);
  zz?.socket?.disconnect();
  zz = new ZirZirClient({ apiUrl: server.replace(/\/$/, ''), storage });
  call = new CallManager(
    zz.api,
    { attachAudio: false, onError: (m) => zz.notify(m, 'error'), onInfo: (m) => zz.notify(m, 'success'), onSound: (e) => sounds.play(e) },
    storage,
  );
  zz.onSound = (e) => sounds.play(e);
  setDndCheck(() => zz.state.me?.status === 'DND');
  // In-app notifications (push notifications for a closed app come later).
  zz.onNotify = (n) => {
    Vibration.vibrate(n.isMention ? [0, 60, 80, 60] : 40);
    zz.notify(`${n.isMention ? '🔔 ' : ''}${n.authorName} · ${n.sessionName} › #${n.channelName}: ${n.text.slice(0, 80)}`);
  };
  zz.onSessionGone = (sid) => {
    if (call.state.sessionId === sid) call.leave();
  };
  zz.onChannelGone = (cid) => {
    if (call.state.channelId === cid) call.leave();
  };
  await zz.start();
  return server;
}

export function useApp<T>(sel: (s: AppState) => T): T {
  return useStore(zz.store, useShallow(sel));
}
export function useCall<T>(sel: (s: CallState) => T): T {
  return useStore(call.store, useShallow(sel));
}
