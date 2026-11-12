import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const apiArg = process.argv.find((a) => a.startsWith('--zz-api-url='));

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void) {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

/** The only API the web app gets from Electron. No Node access is exposed. */
contextBridge.exposeInMainWorld('zirzirDesktop', {
  platform: process.platform,
  apiUrl: apiArg ? apiArg.slice('--zz-api-url='.length) : undefined,
  onScreenPickerRequest: (cb: (sources: unknown[]) => void) => on('screen-picker:open', cb),
  chooseScreenSource: (id: string | null, withAudio: boolean) => ipcRenderer.send('screen-picker:choose', id, withAudio),
  setPttKey: (code: string | null) => ipcRenderer.send('ptt:set-key', code),
  onPtt: (cb: (pressed: boolean) => void) => on('ptt', cb),
  onDeepLink: (cb: (code: string) => void) => on('deep-link', cb),
  setBadge: (n: number) => ipcRenderer.send('badge', n),
});
