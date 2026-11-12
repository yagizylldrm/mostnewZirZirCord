import { STATUSES, type UserStatus } from '@zirzircord/shared';
import { Check, Copy, LogOut, Pencil, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../lib/format';
import { openModal, useApp, zz } from '../lib/zz';
import { Avatar, Banner, cx, inputCls } from './ui';

const STATUS_LABEL: Record<UserStatus, string> = { ONLINE: 'Online', IDLE: 'Idle', DND: 'Do not disturb', INVISIBLE: 'Invisible' };
const STATUS_DOT: Record<UserStatus, string> = { ONLINE: 'bg-ok', IDLE: 'bg-warn', DND: 'bg-danger', INVISIBLE: 'bg-faint' };

/** Popover from the user panel: quick rename, status, account switching, add account, log out. */
export function AccountMenu({ onClose }: { onClose: () => void }) {
  const { me, accounts } = useApp((s) => ({ me: s.me!, accounts: s.accounts }));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.displayName);
  const others = accounts.filter((a) => a.id !== me.id);

  const saveName = async () => {
    const n = name.trim();
    setEditing(false);
    if (n && n !== me.displayName && (await zz.attempt(() => zz.updateProfile({ displayName: n })))) zz.notify('Name updated', 'success');
  };
  const run = (fn: () => unknown) => () => {
    onClose();
    fn();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-2 z-50 mb-2 w-72 overflow-hidden rounded-xl bg-elev text-sm shadow-2xl">
        <Banner user={me} height={56} animate />
        <div className="px-3 pb-3">
          <div className="-mt-7 mb-2 w-fit rounded-full border-4 border-elev">
            <Avatar name={me.displayName} url={me.avatarUrl} staticUrl={me.avatarStaticUrl} size={56} status={me.status} animate />
          </div>
          {editing ? (
            <div className="flex gap-1.5">
              <input
                autoFocus
                className={inputCls}
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => (e.key === 'Enter' ? saveName() : e.key === 'Escape' && setEditing(false))}
              />
              <button className="rounded-md bg-brand px-2 text-white" onClick={saveName} aria-label="Save name">
                <Check size={16} />
              </button>
            </div>
          ) : (
            <button className="group flex items-center gap-1.5 text-base font-bold" onClick={() => (setName(me.displayName), setEditing(true))} title="Change your name">
              {me.displayName}
              <Pencil size={13} className="text-muted opacity-0 group-hover:opacity-100" />
            </button>
          )}
          <button
            className="mt-0.5 flex items-center gap-1 font-mono text-xs text-muted hover:text-fg"
            onClick={async () => (await copyText(me.publicId)) && zz.notify('ID copied', 'success')}
          >
            {me.publicId} <Copy size={11} />
          </button>
          {me.isGuest && <div className="text-xs text-faint">Guest account</div>}
        </div>

        <div className="border-t border-line p-1.5">
          {STATUSES.map((st) => (
            <button
              key={st}
              onClick={() => zz.attempt(() => zz.updateProfile({ status: st }))}
              className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover', me.status === st && 'text-fg')}
            >
              <span className={cx('size-2.5 rounded-full', STATUS_DOT[st])} />
              <span className="flex-1 text-left">{STATUS_LABEL[st]}</span>
              {me.status === st && <Check size={14} className="text-brand" />}
            </button>
          ))}
        </div>

        <div className="border-t border-line p-1.5">
          <button onClick={run(() => openModal({ type: 'userSettings' }))} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover">
            <Settings size={15} /> Edit profile & settings
          </button>
        </div>

        <div className="border-t border-line p-1.5">
          <div className="px-2.5 pt-1 pb-1 text-[11px] font-bold tracking-wide text-muted uppercase">Switch account</div>
          {others.map((a) => (
            <button
              key={a.id}
              onClick={run(() => zz.attempt(() => zz.switchAccount(a.id)))}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover"
            >
              <Avatar name={a.displayName} url={a.avatarUrl} staticUrl={a.avatarStaticUrl} size={26} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate">{a.displayName}</span>
                <span className="block font-mono text-[10px] text-muted">{a.publicId}</span>
              </span>
            </button>
          ))}
          <button onClick={run(() => zz.beginAddAccount())} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-hover">
            <span className="grid size-[26px] place-items-center rounded-full bg-field">
              <Plus size={15} />
            </span>
            Add an account
          </button>
          <button
            onClick={run(() => openModal({ type: 'logout' }))}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-danger hover:bg-danger hover:text-white"
          >
            <LogOut size={15} className="ml-1.5" /> Log out of {me.displayName}
          </button>
        </div>
      </div>
    </>
  );
}
