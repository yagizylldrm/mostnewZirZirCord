import type { NotifyLevel } from '@zirzircord/shared';
import { isSessionMuted } from '@zirzircord/client-core';
import { BellOff } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal, cx } from '../components/ui';
import { ensureNotificationPermission } from '../lib/notify';
import { closeModal, useApp, zz } from '../lib/zz';

const LEVELS: { value: NotifyLevel; title: string; desc: string }[] = [
  { value: 'ALL', title: 'All messages', desc: 'Notify me for every new message.' },
  { value: 'MENTIONS', title: 'Only @mentions', desc: 'Only when someone @mentions me or uses @everyone.' },
  { value: 'NONE', title: 'Nothing', desc: 'Never notify me. Unread badges still show.' },
];

const MUTE_FOR: { label: string; minutes: number | null }[] = [
  { label: '15 minutes', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '8 hours', minutes: 480 },
  { label: '24 hours', minutes: 1440 },
  { label: 'Until I turn it back on', minutes: null },
];

export function NotificationSettingsModal({ sessionId }: { sessionId: string }) {
  const { view, notify, muted } = useApp((s) => ({ view: s.sessions[sessionId], notify: s.notify[sessionId], muted: isSessionMuted(s, sessionId) }));
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  if (!view) return null;
  const level = notify?.level ?? 'ALL';
  const until = notify?.mutedUntil;
  const forever = until && new Date(until).getFullYear() > 9000;

  const update = async (input: Parameters<typeof zz.setSessionNotify>[1]) => {
    setBusy(true);
    await zz.attempt(() => zz.setSessionNotify(sessionId, input));
    setBusy(false);
  };
  const muteFor = (minutes: number | null) =>
    update({ mutedUntil: new Date(minutes === null ? Date.UTC(9999, 0, 1) : Date.now() + minutes * 60_000).toISOString() });

  return (
    <Modal title={`Notifications · ${view.session.name}`} onClose={closeModal}>
      <div className="space-y-5">
        {perm !== 'granted' && perm !== 'unsupported' && (
          <div className="flex items-center gap-3 rounded-lg bg-warn/15 p-3 text-sm text-warn">
            <span className="flex-1">Allow desktop notifications to get alerts while ZirZirCord is in the background.</span>
            <Button className="shrink-0 bg-warn text-black" onClick={async () => (await ensureNotificationPermission(), setPerm(Notification.permission))}>
              Allow
            </Button>
          </div>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Mute session</h3>
          {muted ? (
            <div className="flex items-center gap-3 rounded-lg bg-side p-3">
              <BellOff size={18} className="text-muted" />
              <div className="flex-1 text-sm">Muted {forever ? 'until you turn it back on' : `until ${new Date(until!).toLocaleString()}`}</div>
              <Button variant="secondary" disabled={busy} onClick={() => update({ mutedUntil: null })}>
                Unmute
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MUTE_FOR.map((m) => (
                <button key={m.label} disabled={busy} onClick={() => muteFor(m.minutes)} className="rounded-md bg-side px-3 py-2 text-left text-sm hover:bg-hover">
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-faint">While muted you get no notifications or sounds from this session, not even @mentions.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Notify me about</h3>
          {LEVELS.map((l) => (
            <button
              key={l.value}
              disabled={busy}
              onClick={() => update({ level: l.value })}
              className={cx('flex w-full items-start gap-3 rounded-lg border p-3 text-left', level === l.value ? 'border-brand bg-brand/10' : 'border-line hover:bg-hover')}
            >
              <span className={cx('mt-1 size-3.5 shrink-0 rounded-full border-2', level === l.value ? 'border-brand bg-brand' : 'border-muted')} />
              <span>
                <span className="block text-sm font-medium">{l.title}</span>
                <span className="block text-xs text-muted">{l.desc}</span>
              </span>
            </button>
          ))}
          <p className="text-xs text-faint">Tip: hover a channel and click the bell to mute just that channel.</p>
        </section>
      </div>
    </Modal>
  );
}
