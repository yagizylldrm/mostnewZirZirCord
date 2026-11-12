import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  systemPreferences,
  Tray,
  type DesktopCapturerSource,
} from 'electron';
import path from 'node:path';

const DEV_URL = process.env.ZZ_DEV_URL;
const API_URL = process.env.ZZ_API_URL ?? 'http://localhost:4000';
const SMOKE = process.env.ZZ_SMOKE === '1';
const PROTOCOL = 'zirzircord';

// macOS: allow capturing system audio when sharing the screen (ScreenCaptureKit).
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacCatapLoopbackAudioForScreenShare');
// Keep audio/video smooth when the window is in the background.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let pendingDeepLink: string | null = null;

// ------------------------------------------------------------- deep links

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function handleDeepLink(url: string) {
  const m = /^zirzircord:\/\/join\/([\w-]+)/i.exec(url);
  if (!m) return;
  if (win && !win.webContents.isLoading()) {
    win.webContents.send('deep-link', m[1]);
    showWindow();
  } else pendingDeepLink = m[1];
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleDeepLink(link);
    showWindow();
  });
}
app.on('open-url', (e, url) => {
  e.preventDefault();
  handleDeepLink(url);
});

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ------------------------------------------------------------ screen share

let pendingCapture: { sources: DesktopCapturerSource[]; callback: (r: Electron.Streams) => void } | null = null;

function setupMediaHandlers() {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // getDisplayMedia() → our own picker UI in the renderer.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 400, height: 225 },
        fetchWindowIcons: true,
      });
      pendingCapture?.callback({});
      pendingCapture = { sources, callback };
      win?.webContents.send(
        'screen-picker:open',
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          thumbnail: s.thumbnail.toDataURL(),
          appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
          isScreen: s.id.startsWith('screen:'),
        })),
      );
    } catch (e) {
      console.error('getSources failed', e);
      callback({});
    }
  });

  ipcMain.on('screen-picker:choose', (_e, id: string | null, withAudio: boolean) => {
    const pending = pendingCapture;
    pendingCapture = null;
    if (!pending) return;
    const source = id ? pending.sources.find((s) => s.id === id) : undefined;
    if (!source) return pending.callback({});
    // System audio capture: Windows (loopback) and macOS 13+ (ScreenCaptureKit). Not on Linux.
    const audio = withAudio && process.platform !== 'linux' ? 'loopback' : undefined;
    pending.callback(audio ? { video: source, audio } : { video: source });
  });
}

// ------------------------------------------------- global push-to-talk

/** DOM KeyboardEvent.code → uiohook key name. */
function uiohookKeyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return code;
  const map: Record<string, string> = {
    Backquote: 'Backquote', Space: 'Space', CapsLock: 'CapsLock', Tab: 'Tab', Escape: 'Escape',
    ControlLeft: 'Ctrl', ControlRight: 'CtrlRight', AltLeft: 'Alt', AltRight: 'AltRight',
    ShiftLeft: 'Shift', ShiftRight: 'ShiftRight', MetaLeft: 'Meta', MetaRight: 'MetaRight',
    Minus: 'Minus', Equal: 'Equal', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight',
    Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash',
    Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  };
  return map[code] ?? null;
}

let hook: any = null;
let pttKeycode: number | null = null;
let pttDown = false;

function setupPtt() {
  ipcMain.on('ptt:set-key', (_e, code: string | null) => {
    if (!code) {
      pttKeycode = null;
      return;
    }
    if (!hook) {
      try {
        // Native module; optional. macOS needs Accessibility permission for global keys.
        const { uIOhook } = require('uiohook-napi');
        hook = uIOhook;
        hook.on('keydown', (e: { keycode: number }) => {
          if (e.keycode === pttKeycode && !pttDown) {
            pttDown = true;
            win?.webContents.send('ptt', true);
          }
        });
        hook.on('keyup', (e: { keycode: number }) => {
          if (e.keycode === pttKeycode && pttDown) {
            pttDown = false;
            win?.webContents.send('ptt', false);
          }
        });
        if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
          systemPreferences.isTrustedAccessibilityClient(true); // shows the macOS prompt
        }
        hook.start();
      } catch (e) {
        console.warn('Global push-to-talk unavailable:', (e as Error).message);
        hook = null;
        return;
      }
    }
    const { UiohookKey } = require('uiohook-napi');
    const name = uiohookKeyName(code);
    pttKeycode = name && UiohookKey[name] !== undefined ? UiohookKey[name] : null;
  });
}

// ------------------------------------------------------------------ window

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 500,
    show: false,
    backgroundColor: '#111214',
    title: 'ZirZirCord',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: [`--zz-api-url=${API_URL}`],
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.on('close', (e) => {
    if (!quitting && process.platform !== 'linux' && !SMOKE) {
      e.preventDefault(); // keep running in the tray so calls continue
      win?.hide();
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      win?.webContents.send('deep-link', pendingDeepLink);
      pendingDeepLink = null;
    }
    if (SMOKE) {
      win?.webContents
        .executeJavaScript('document.title + " | bridge=" + typeof window.zirzirDesktop + " | api=" + window.zirzirDesktop?.apiUrl')
        .then((r) => {
          console.log(`SMOKE OK: ${r}`);
          app.exit(0);
        });
    }
  });
  win.once('ready-to-show', () => !SMOKE && win?.show());

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(app.isPackaged ? path.join(process.resourcesPath, 'web', 'index.html') : path.join(__dirname, '..', 'web', 'index.html'));
}

function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'web', 'icon-32.png')
    : path.join(__dirname, '..', '..', 'web', 'public', 'icon-32.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  try {
    tray = new Tray(image.resize({ width: 18, height: 18 }));
    tray.setToolTip('ZirZirCord');
    if (image.isEmpty()) tray.setTitle?.('ZZ');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open ZirZirCord', click: showWindow },
        { type: 'separator' },
        { label: 'Quit', click: () => ((quitting = true), app.quit()) },
      ]),
    );
    tray.on('click', showWindow);
  } catch {
    tray = null;
  }
}

app.whenReady().then(() => {
  setupMediaHandlers();
  setupPtt();
  ipcMain.on('badge', (_e, n: number) => app.setBadgeCount?.(n));
  createWindow();
  if (!SMOKE) createTray();
  const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleDeepLink(link);
});

app.on('activate', showWindow);
app.on('before-quit', () => {
  quitting = true;
  try {
    hook?.stop();
  } catch {}
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
