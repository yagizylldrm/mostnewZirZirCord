import { Component, type ReactNode, useEffect } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { ScreenPicker } from './components/ScreenPicker';
import { Shell } from './components/Shell';
import { Logo, Toasts } from './components/ui';
import { desktop } from './lib/desktop';
import { normalizeSessionCode } from '@zirzircord/shared';
import { call, openModal, ui, useApp } from './lib/zz';

/** Push-to-talk: in-window key handling (desktop app adds a global hook). */
function usePushToTalk() {
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === ui.getState().pttKey && !isTyping(e) && !e.repeat) call.setPttPressed(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === ui.getState().pttKey) call.setPttPressed(false);
    };
    const blur = () => call.setPttPressed(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    const offDesktop = desktop?.onPtt((p) => call.setPttPressed(p));
    desktop?.setPttKey(call.state.pttMode ? ui.getState().pttKey : null);
    const unsub = call.store.subscribe((s, prev) => {
      if (s.pttMode !== prev.pttMode) desktop?.setPttKey(s.pttMode ? ui.getState().pttKey : null);
    });
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      offDesktop?.();
      unsub();
    };
  }, []);
}

/** Opens the join dialog for links like https://app/#join=ABCD-EFGH or zirzircord://join/ABCD-EFGH */
function useJoinLinks(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    const m = /join=([\w-]+)/.exec(location.hash);
    if (m && normalizeSessionCode(m[1])) {
      openModal({ type: 'joinSession', code: m[1] });
      history.replaceState(null, '', location.pathname);
    }
    return desktop?.onDeepLink((code) => openModal({ type: 'joinSession', code }));
  }, [signedIn]);
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-rail p-6 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="text-sm text-muted">{this.state.error.message}</p>
          <button className="rounded-md bg-brand px-4 py-2 text-sm text-white" onClick={() => location.reload()}>
            Reload ZirZirCord
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function AppInner() {
  const { ready, me, adding } = useApp((s) => ({ ready: s.ready, me: s.me, adding: s.addingAccount }));
  usePushToTalk();
  useJoinLinks(!!me);

  return (
    <>
      {!ready ? (
        <div className="grid h-full place-items-center bg-rail">
          <div className="flex flex-col items-center gap-4 text-muted">
            <div className="animate-pulse">
              <Logo size={72} />
            </div>
            Loading ZirZirCord…
          </div>
        </div>
      ) : me && !adding ? (
        <Shell />
      ) : (
        <AuthScreen />
      )}
      <ScreenPicker />
      <Toasts />
    </>
  );
}
