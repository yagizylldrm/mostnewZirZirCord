import { type FormEvent, useState } from 'react';
import { useApp, zz } from '../lib/zz';
import { Button, Field, Logo, cx, inputCls } from './ui';

type Tab = 'guest' | 'login' | 'register';

export function AuthScreen() {
  const [tab, setTab] = useState<Tab>('guest');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { adding, current } = useApp((s) => ({ adding: s.addingAccount && !!s.me, current: s.me?.displayName }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (tab === 'guest') await zz.guest(name.trim());
      else if (tab === 'login') await zz.login(email, password);
      else await zz.register(name.trim(), email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center bg-[radial-gradient(ellipse_at_top,#3a2216,#111214_60%)] p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-main p-7 shadow-2xl">
        {adding && (
          <button type="button" onClick={() => zz.cancelAddAccount()} className="text-sm text-muted hover:text-fg">
            ← Back to {current}
          </button>
        )}
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size={64} />
          <h1 className="text-2xl font-bold">ZirZirCord</h1>
          <p className="text-sm text-muted">{adding ? 'Add another account. You can switch between them any time.' : 'Private sessions with a code. Talk, share your screen, send anything.'}</p>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-rail p-1 text-sm">
          {(['guest', 'login', 'register'] as Tab[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={cx('rounded-md py-1.5 transition', tab === t ? 'bg-field font-semibold text-fg' : 'text-muted hover:text-fg')}
            >
              {t === 'guest' ? 'Guest' : t === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>
        {tab !== 'login' && (
          <Field label="Display name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required autoFocus />
          </Field>
        )}
        {tab !== 'guest' && (
          <>
            <Field label="Email" hint={tab === 'register' ? 'Never shown to anyone. Only used to sign in.' : undefined}>
              <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password">
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={tab === 'register' ? 8 : 1}
                required
                autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              />
            </Field>
          </>
        )}
        {tab === 'guest' && (
          <p className="text-xs text-faint">
            Guests get a temporary ID on this device. Create an account later to keep it and to own set sessions.
          </p>
        )}
        {error && <p className="rounded-md bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button className="w-full py-2.5" disabled={busy}>
          {busy ? 'Please wait…' : tab === 'guest' ? 'Continue as guest' : tab === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
    </div>
  );
}
