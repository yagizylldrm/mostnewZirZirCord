import { Menu, Users } from 'lucide-react';
import { useEffect } from 'react';
import { ChannelSidebar } from './ChannelSidebar';
import { CallView } from './CallView';
import { ChatView } from './ChatView';
import { FloatingScreen } from './FloatingScreen';
import { Home } from './Home';
import { Lightbox } from './Lightbox';
import { MemberList } from './MemberList';
import { Modals } from '../modals/Modals';
import { ProfilePopover } from './ProfilePopover';
import { SessionRail } from './SessionRail';
import { IconButton, cx } from './ui';
import { ui, useApp, useUi } from '../lib/zz';

export function Shell() {
  const { activeSessionId, hasSession, connected } = useApp((s) => ({
    activeSessionId: s.activeSessionId,
    hasSession: !!(s.activeSessionId && s.sessions[s.activeSessionId]),
    connected: s.connected,
  }));
  const { drawerOpen, membersOpen, showCall } = useUi((u) => ({
    drawerOpen: u.drawerOpen,
    membersOpen: u.membersOpen,
    showCall: !!(activeSessionId && u.callView[activeSessionId]),
  }));

  // Close the mobile drawer on navigation.
  useEffect(() => ui.setState({ drawerOpen: false }), [activeSessionId]);
  // The member list is a side column on wide screens and an overlay on narrow ones.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = () => mq.matches && ui.setState({ membersOpen: false });
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="flex h-full overflow-hidden bg-main">
      {/* Left: rail + channel sidebar. Inline on desktop, drawer on narrow screens. */}
      <div
        className={cx(
          'z-40 flex h-full shrink-0 transition-transform max-md:fixed max-md:inset-y-0 max-md:left-0',
          drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
        )}
      >
        <SessionRail />
        {hasSession && <ChannelSidebar />}
      </div>
      {drawerOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => ui.setState({ drawerOpen: false })} />}

      <main className="flex min-w-0 flex-1 flex-col">
        {!connected && (
          <div className="bg-warn px-3 py-1 text-center text-xs font-medium text-black">Reconnecting to ZirZirCord…</div>
        )}
        <div className="flex h-12 items-center gap-2 border-b border-black/30 px-2 md:hidden">
          <IconButton label="Menu" onClick={() => ui.setState({ drawerOpen: true })}>
            <Menu size={20} />
          </IconButton>
          <div className="flex-1" />
          {hasSession && (
            <IconButton label="Members" onClick={() => ui.setState((s) => ({ membersOpen: !s.membersOpen }))}>
              <Users size={18} />
            </IconButton>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{!hasSession ? <Home /> : showCall ? <CallView /> : <ChatView />}</div>
          {hasSession && membersOpen && (
            <>
              <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => ui.setState({ membersOpen: false })} />
              <div className="max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:shadow-2xl">
                <MemberList />
              </div>
            </>
          )}
        </div>
      </main>
      <FloatingScreen />
      <Modals />
      <ProfilePopover />
      <Lightbox />
    </div>
  );
}
