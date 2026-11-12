import { formatSessionCode, normalizeSessionCode } from '@zirzircord/shared';
import { type FormEvent, useState } from 'react';
import { Button, Field, Modal, ToggleRow, inputCls } from '../components/ui';
import { closeModal, useApp, zz } from '../lib/zz';

export function CreateSessionModal() {
  const me = useApp((s) => s.me!);
  const [name, setName] = useState(`${me.displayName}'s session`);
  const [isSet, setIsSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const s = await zz.attempt(() => zz.createSession(name.trim(), isSet));
    setBusy(false);
    if (s) {
      closeModal();
      zz.notify(`Session created. Invite code: ${formatSessionCode(s.code)}`, 'success');
    }
  };
  return (
    <Modal title="Create a session" onClose={closeModal}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Session name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={48} required autoFocus />
        </Field>
        <ToggleRow
          title="Set session"
          desc={
            me.isGuest
              ? 'Create an account to make permanent sessions.'
              : 'Stays available after everyone leaves. Past visitors can reopen it any time.'
          }
          checked={isSet}
          onChange={setIsSet}
          disabled={me.isGuest}
        />
        <p className="text-xs text-faint">You will get an invite code. Only people with the code can join. Nobody sees your email or IP.</p>
        <Button className="w-full" disabled={busy || !name.trim()}>
          Create
        </Button>
      </form>
    </Modal>
  );
}

export function JoinSessionModal({ initialCode }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = !!normalizeSessionCode(code);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await zz.joinByCode(code);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Join a session" onClose={closeModal}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Invite code" hint="Looks like ABCD-1234. Letters are not case-sensitive.">
          <input
            className={`${inputCls} text-center font-mono text-2xl tracking-[0.3em] uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            maxLength={12}
            autoFocus
          />
        </Field>
        {error && <p className="rounded-md bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>}
        <Button className="w-full" disabled={busy || !valid}>
          Join session
        </Button>
      </form>
    </Modal>
  );
}

export function NicknameModal() {
  const { view, me } = useApp((s) => ({ view: s.sessions[s.activeSessionId!], me: s.me! }));
  const [nick, setNick] = useState(view?.members[me.id]?.nickname ?? '');
  if (!view) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if ((await zz.attempt(() => zz.api.setNickname(view.session.id, nick.trim() || null))) !== undefined) closeModal();
  };
  return (
    <Modal title={`Nickname in ${view.session.name}`} onClose={closeModal}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Nickname" hint="Only shown in this session. Leave empty to use your display name.">
          <input className={inputCls} value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder={me.displayName} autoFocus />
        </Field>
        <Button className="w-full">Save</Button>
      </form>
    </Modal>
  );
}
