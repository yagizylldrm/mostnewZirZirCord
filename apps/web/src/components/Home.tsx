import { SLEEP } from '@zirzircord/shared';
import { Crown, LogIn, Plus, Radio, Trash2 } from 'lucide-react';
import { sleepLabel } from '@zirzircord/client-core';
import { openModal, useApp, zz } from '../lib/zz';
import { UserPanel } from './UserPanel';
import { SessionPicture } from './SessionPicture';
import { Button, Logo, cx } from './ui';

export function Home() {
  const { me, setSessions, openSessions, sessions } = useApp((s) => ({
    me: s.me!,
    setSessions: s.sidebar.setSessions,
    openSessions: s.sidebar.openSessions,
    sessions: s.sessions,
  }));
  const rejoinable = openSessions.filter((i) => !sessions[i.session.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <header className="flex items-center gap-4">
            <Logo size={56} />
            <div>
              <h1 className="text-2xl font-bold">Hey {me.displayName}!</h1>
              <p className="text-sm text-muted">
                Your ID is <span className="font-mono text-fg">{me.publicId}</span>. Share session codes, never personal info.
              </p>
            </div>
          </header>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => openModal({ type: 'createSession' })}
              className="flex items-center gap-4 rounded-xl bg-side p-5 text-left transition hover:bg-hover"
            >
              <span className="grid size-12 place-items-center rounded-full bg-ok/20 text-ok">
                <Plus />
              </span>
              <span>
                <span className="block font-semibold">Create a session</span>
                <span className="text-sm text-muted">Get a code and invite people</span>
              </span>
            </button>
            <button
              onClick={() => openModal({ type: 'joinSession' })}
              className="flex items-center gap-4 rounded-xl bg-side p-5 text-left transition hover:bg-hover"
            >
              <span className="grid size-12 place-items-center rounded-full bg-brand/20 text-brand">
                <LogIn />
              </span>
              <span>
                <span className="block font-semibold">Join with a code</span>
                <span className="text-sm text-muted">Someone shared a code with you</span>
              </span>
            </button>
          </div>

          {rejoinable.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-wider text-muted uppercase">Still running</h2>
              {rejoinable.map((i) => (
                <div key={i.session.id} className="flex items-center gap-3 rounded-lg bg-side p-3">
                  <SessionPicture s={i.session} className="size-10 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.session.name}</div>
                    <div className="text-xs text-muted">{i.presentCount} online</div>
                  </div>
                  <Button onClick={() => zz.attempt(() => zz.openSession(i.session.id))}>Rejoin</Button>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-xs font-bold tracking-wider text-muted uppercase">Set sessions</h2>
            {setSessions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line p-5 text-sm text-muted">
                Set sessions are saved sessions you have visited. Open one any time: if nobody is there, you start hosting it. A set session nobody opens
                for {SLEEP.afterDays + SLEEP.deleteAfterDays} days is deleted with all its messages and files.
              </p>
            ) : (
              setSessions.map((i) => {
                const inside = !!sessions[i.session.id];
                return (
                  <div key={i.session.id} className="flex items-center gap-3 rounded-lg bg-side p-3">
                    <SessionPicture s={i.session} className="size-10 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate font-medium">
                        {i.session.name}
                        {i.session.ownerId === me.id && <Crown size={14} className="text-owner" />}
                      </div>
                      {sleepLabel(i.session) ? (
                        <div className={cx('text-xs', sleepLabel(i.session)!.urgent ? 'font-medium text-warn' : 'text-muted')}>
                          {sleepLabel(i.session)!.text}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-muted">
                          {i.live ? (
                            <>
                              <Radio size={12} className="text-ok" /> Live · {i.presentCount} online
                            </>
                          ) : (
                            'Nobody here right now'
                          )}
                        </div>
                      )}
                    </div>
                    {inside ? (
                      <Button variant="secondary" onClick={() => zz.setActiveSession(i.session.id)}>
                        Open
                      </Button>
                    ) : (
                      <Button onClick={() => zz.attempt(() => zz.openSession(i.session.id))}>{i.live ? 'Join' : 'Start hosting'}</Button>
                    )}
                    {i.session.ownerId !== me.id && (
                      <button
                        title="Remove from my list"
                        className="p-2 text-faint hover:text-danger"
                        onClick={() =>
                          zz.attempt(async () => {
                            await zz.api.forgetSession(i.session.id);
                            await zz.refreshSidebar();
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </section>
        </div>
      </div>
      <div className="border-t border-black/30 bg-side md:w-72 md:rounded-tr-lg">
        <UserPanel />
      </div>
    </div>
  );
}
