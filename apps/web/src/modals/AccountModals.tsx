import { type FormEvent, useState } from 'react';
import { ApiError } from '@zirzircord/client-core';
import { Button, Field, Modal, inputCls } from '../components/ui';
import { closeModal, openModal, useApp, zz } from '../lib/zz';

/** Log out. For guests this deletes the account, so it says so and offers to keep it instead. */
export function LogoutModal() {
  const me = useApp((s) => s.me!);
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    closeModal();
    await zz.attempt(() => zz.logout());
  };
  return (
    <Modal
      title={`Log out of ${me.displayName}?`}
      onClose={closeModal}
      footer={
        <>
          {me.isGuest && (
            <Button variant="secondary" onClick={() => openModal({ type: 'userSettings', tab: 'account' })}>
              Create account instead
            </Button>
          )}
          <Button variant="danger" disabled={busy} onClick={logout}>
            {me.isGuest ? 'Log out & delete' : 'Log out'}
          </Button>
        </>
      }
    >
      {me.isGuest ? (
        <p className="text-sm text-muted">
          This is a guest account. Logging out <b className="text-fg">permanently deletes</b> it, with its ID{' '}
          <span className="font-mono">{me.publicId}</span>, roles and stickers. Your messages stay, shown as “Deleted user”. Sessions you own pass to
          the member who joined first.
          <br />
          <br />
          Guest accounts are also deleted automatically after 24 hours offline.
        </p>
      ) : (
        <p className="text-sm text-muted">You can sign back in any time with your email and password.</p>
      )}
    </Modal>
  );
}

/** Permanently delete the current account. Registered accounts confirm with their password. */
export function DeleteAccountModal() {
  const me = useApp((s) => s.me!);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = me.isGuest ? confirmText.trim().toUpperCase() === 'DELETE' : password.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await zz.deleteAccount(me.isGuest ? undefined : password);
      closeModal();
      zz.notify('Your account was deleted', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Delete account"
      onClose={closeModal}
      footer={
        <>
          <Button variant="ghost" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant="danger" form="delete-account" disabled={!ready || busy}>
            {busy ? 'Deleting…' : 'Delete forever'}
          </Button>
        </>
      }
    >
      <form id="delete-account" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">
          This permanently deletes <b className="text-fg">{me.displayName}</b> (<span className="font-mono">{me.publicId}</span>): your profile,
          avatar, banner and stickers. It can’t be undone.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Your messages stay in sessions, shown as “Deleted user”.</li>
          <li>Sessions you own pass to the member who joined first (or are deleted if nobody else is in them).</li>
        </ul>
        {me.isGuest ? (
          <Field label='Type "DELETE" to confirm'>
            <input className={inputCls} autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
        ) : (
          <Field label="Your password">
            <input
              className={inputCls}
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {error && <div className="text-sm text-danger">{error}</div>}
      </form>
    </Modal>
  );
}
