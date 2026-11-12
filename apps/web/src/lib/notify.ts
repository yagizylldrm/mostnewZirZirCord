import { sessionUnread, type IncomingNotification } from '@zirzircord/client-core';
import { desktop } from './desktop';
import { ui, zz } from './zz';

export async function ensureNotificationPermission() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Called by the client for every message that should notify. */
export function showNotification(n: IncomingNotification) {
  const hidden = document.visibilityState !== 'visible' || !document.hasFocus();
  if (hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const note = new Notification(`${n.authorName} · #${n.channelName}`, {
      body: n.text.slice(0, 180),
      icon: n.authorAvatarUrl ?? './icon-192.png',
      tag: n.channelId,
      silent: true, // we play our own ping
    });
    note.onclick = () => {
      window.focus();
      zz.setActiveSession(n.sessionId);
      zz.setActiveChannel(n.sessionId, n.channelId);
      ui.setState((u) => ({ callView: { ...u.callView, [n.sessionId]: false } }));
      note.close();
    };
  } else if (!hidden) {
    zz.notify(`${n.isMention ? '🔔 ' : ''}${n.authorName} in ${n.sessionName} › #${n.channelName}: ${n.text.slice(0, 80)}`);
  }
}

/** Keeps the tab title and the desktop badge in sync with unread mentions/messages. */
export function startBadgeSync() {
  const update = () => {
    const s = zz.state;
    let mentions = 0;
    let any = false;
    for (const sid of Object.keys(s.sessions)) {
      const u = sessionUnread(s, sid);
      mentions += u.mentions;
      if (u.count) any = true;
    }
    document.title = mentions ? `(${mentions}) ZirZirCord` : any ? '• ZirZirCord' : 'ZirZirCord';
    desktop?.setBadge(mentions);
  };
  update();
  return zz.store.subscribe((st, prev) => {
    if (st.unread !== prev.unread || st.sessions !== prev.sessions || st.channelMutes !== prev.channelMutes) update();
  });
}
