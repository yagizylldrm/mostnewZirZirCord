import { PROFILE_IMAGE_MAX_BYTES, can, canModerate, formatSessionCode, type BanDTO, type SessionDTO, SET_SESSION_EXPIRY_NOTE } from '@zirzircord/shared';
import { listedMembers, memberName } from '@zirzircord/client-core';
import { Copy, RefreshCw } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Avatar, Button, Field, Modal, RoleBadge, ToggleRow, cx, inputCls } from '../components/ui';
import { SessionPicture } from '../components/SessionPicture';
import { copyText } from '../lib/format';
import { closeModal, useApp, zz } from '../lib/zz';

type Tab = 'overview' | 'members' | 'bans' | 'channelBans';

export function SessionSettingsModal() {
  const { view, me } = useApp((s) => ({ view: s.sessions[s.activeSessionId!], me: s.me! }));
  const [tab, setTab] = useState<Tab>('overview');
  if (!view) return null;
  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['members', 'Members & roles'],
    ['bans', 'Session bans'],
    ['channelBans', 'Channel bans'],
  ];
  return (
    <Modal title={`${view.session.name} — settings`} onClose={closeModal} wide>
      <div className="flex flex-col gap-4 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-44 md:flex-col">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx('rounded-md px-3 py-2 text-left text-sm whitespace-nowrap', tab === t ? 'bg-field text-fg' : 'text-muted hover:bg-hover')}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'overview' && <Overview />}
          {tab === 'members' && <Members />}
          {tab === 'bans' && <Bans />}
          {tab === 'channelBans' && <ChannelBans />}
        </div>
      </div>
    </Modal>
  );

  function Overview() {
    const s = view.session;
    const isOwner = view.myRole === 'OWNER';
    const [name, setName] = useState(s.name);
    const update = (input: Parameters<typeof zz.api.updateSession>[1]) => zz.attempt(() => zz.api.updateSession(s.id, input));
    return (
      <div className="space-y-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ name: name.trim() });
          }}
        >
          <Field label="Session name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
          </Field>
          <Button disabled={name.trim() === s.name || !name.trim()}>Save</Button>
        </form>
        {can(view.myRole, 'session.editSettings') && <PictureSetting s={s} />}
        <div className="rounded-lg bg-side p-3">
          <div className="text-xs font-bold text-muted">INVITE CODE</div>
          <div className="flex items-center gap-2">
            <span className="flex-1 font-mono text-xl tracking-widest">{formatSessionCode(s.code)}</span>
            <Button variant="secondary" onClick={async () => (await copyText(formatSessionCode(s.code))) && zz.notify('Copied', 'success')}>
              <Copy size={16} />
            </Button>
            {isOwner && (
              <Button
                variant="secondary"
                title="New code (old one stops working)"
                onClick={() => confirm('Generate a new code? The old one will stop working.') && zz.attempt(() => zz.api.rotateCode(s.id))}
              >
                <RefreshCw size={16} />
              </Button>
            )}
          </div>
        </div>
        <div className="divide-y divide-line">
          <ToggleRow
            title="Set session"
            desc={isOwner ? (me.isGuest ? 'Create an account to make set sessions.' : `Keep this session (and its history) after everyone leaves. ${SET_SESSION_EXPIRY_NOTE}`) : 'Only the owner can change this.'}
            checked={s.isSet}
            disabled={!isOwner || (me.isGuest && !s.isSet)}
            onChange={(v) => update({ isSet: v })}
          />
          <ToggleRow title="Members can create text channels" checked={s.membersCanCreateText} onChange={(v) => update({ membersCanCreateText: v })} />
          <ToggleRow title="Members can create voice channels" checked={s.membersCanCreateVoice} onChange={(v) => update({ membersCanCreateVoice: v })} />
          <ToggleRow title="Accounts only" desc="Block guests from joining with the code." checked={s.accountsOnly} onChange={(v) => update({ accountsOnly: v })} />
          <ToggleRow
            title="Members can use @everyone"
            desc="Owner and mods can always ping everyone. Turn on to let all members do it."
            checked={s.membersCanMentionEveryone}
            onChange={(v) => update({ membersCanMentionEveryone: v })}
          />
        </div>
        {isOwner && (
          <div className="rounded-lg border border-danger/40 p-3">
            <div className="text-sm font-semibold text-danger">Delete session</div>
            <p className="mb-2 text-xs text-muted">Removes the session for everyone, with all messages and files.</p>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Delete "${s.name}" for everyone?`)) return;
                if ((await zz.attempt(() => zz.api.deleteSession(s.id))) !== undefined) closeModal();
              }}
            >
              Delete session
            </Button>
          </div>
        )}
      </div>
    );
  }

  function Members() {
    const [modId, setModId] = useState('');
    const members = listedMembers(view).sort((a, b) => ['OWNER', 'MOD', 'MEMBER'].indexOf(a.role) - ['OWNER', 'MOD', 'MEMBER'].indexOf(b.role));
    const isOwner = view.myRole === 'OWNER';
    const addMod = async (e: FormEvent) => {
      e.preventDefault();
      if ((await zz.attempt(() => zz.api.addMod(view.session.id, modId))) !== undefined) {
        setModId('');
        zz.notify('Moderator added', 'success');
      }
    };
    return (
      <div className="space-y-4">
        {isOwner && (
          <form onSubmit={addMod} className="flex items-end gap-2">
            <Field label="Add moderator by ID" hint="The person must have joined this session before.">
              <input className={`${inputCls} font-mono uppercase`} value={modId} onChange={(e) => setModId(e.target.value)} placeholder="ZZ-XXXXXX" />
            </Field>
            <Button disabled={modId.trim().length < 4}>Add</Button>
          </form>
        )}
        <div className="space-y-1">
          {members.map((m) => {
            const isMe = m.user.id === me.id;
            const mayMod = !isMe && canModerate(view.myRole, m.role);
            return (
              <div key={m.user.id} className="flex items-center gap-3 rounded-md bg-side px-3 py-2">
                <Avatar name={memberName(view, m.user.id)} url={m.user.avatarUrl} staticUrl={m.user.avatarStaticUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate text-sm font-medium">
                    {memberName(view, m.user.id)} <RoleBadge role={m.role} />
                  </div>
                  <div className="font-mono text-xs text-muted">{m.user.publicId}</div>
                </div>
                {isOwner && !isMe && m.role !== 'OWNER' && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => zz.attempt(() => (m.role === 'MOD' ? zz.api.removeMod(view.session.id, m.user.id) : zz.api.addMod(view.session.id, m.user.publicId)))}
                  >
                    {m.role === 'MOD' ? 'Unmod' : 'Make mod'}
                  </Button>
                )}
                {mayMod && (
                  <>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => zz.attempt(() => zz.api.kick(view.session.id, m.user.id))}>
                      Kick
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-danger"
                      onClick={() => {
                        const r = prompt(`Ban ${m.user.displayName}? Optional reason:`);
                        if (r !== null) zz.attempt(() => zz.api.ban(view.session.id, { userId: m.user.id }, r || undefined));
                      }}
                    >
                      Ban
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function Bans() {
    const [bans, setBans] = useState<BanDTO[] | null>(null);
    const [target, setTarget] = useState('');
    const load = () => zz.attempt(() => zz.api.sessionBans(view.session.id)).then((b) => b && setBans(b));
    useEffect(() => {
      load();
    }, []);
    const banById = async (e: FormEvent) => {
      e.preventDefault();
      if ((await zz.attempt(() => zz.api.ban(view.session.id, { publicId: target }))) !== undefined) {
        setTarget('');
        load();
      }
    };
    return (
      <div className="space-y-4">
        <form onSubmit={banById} className="flex items-end gap-2">
          <Field label="Ban by ID" hint="Works even if they are not here right now. Also blocks their devices.">
            <input className={`${inputCls} font-mono uppercase`} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="ZZ-XXXXXX" />
          </Field>
          <Button variant="danger" disabled={target.trim().length < 4}>
            Ban
          </Button>
        </form>
        {bans === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : bans.length === 0 ? (
          <p className="text-sm text-muted">Nobody is banned.</p>
        ) : (
          bans.map((b) => (
            <div key={b.user.id} className="flex items-center gap-3 rounded-md bg-side px-3 py-2">
              <Avatar name={b.user.displayName} url={b.user.avatarUrl} staticUrl={b.user.avatarStaticUrl} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{b.user.displayName}</div>
                <div className="text-xs text-muted">
                  <span className="font-mono">{b.user.publicId}</span> {b.reason && `· ${b.reason}`}
                </div>
              </div>
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => zz.attempt(() => zz.api.unban(view.session.id, b.user.id)).then(load)}>
                Unban
              </Button>
            </div>
          ))
        )}
      </div>
    );
  }

  function ChannelBans() {
    const [channelId, setChannelId] = useState(view.channels[0]?.id ?? '');
    const [bans, setBans] = useState<BanDTO[]>([]);
    const [userId, setUserId] = useState('');
    const load = async () => {
      if (!channelId) return;
      const b = await zz.attempt(() => zz.api.channelBans(channelId));
      if (b) setBans(b);
    };
    useEffect(() => {
      load();
    }, [channelId]);
    const candidates = listedMembers(view).filter((m) => m.user.id !== me.id && canModerate(view.myRole, m.role) && !bans.some((b) => b.user.id === m.user.id));
    if (!can(view.myRole, 'channel.ban')) return <p className="text-sm text-muted">No permission.</p>;
    return (
      <div className="space-y-4">
        <Field label="Channel">
          <select className={inputCls} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {view.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type === 'TEXT' ? '#' : '🔊'} {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          <Field label="Ban a member from this channel">
            <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose member…</option>
              {candidates.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {memberName(view, m.user.id)} ({m.user.publicId})
                </option>
              ))}
            </select>
          </Field>
          <Button
            variant="danger"
            disabled={!userId}
            onClick={() => zz.attempt(() => zz.api.channelBan(channelId, userId)).then(() => (setUserId(''), load()))}
          >
            Ban
          </Button>
        </div>
        {bans.length === 0 ? (
          <p className="text-sm text-muted">Nobody is banned from this channel.</p>
        ) : (
          bans.map((b) => (
            <div key={b.user.id} className="flex items-center gap-3 rounded-md bg-side px-3 py-2">
              <Avatar name={b.user.displayName} url={b.user.avatarUrl} staticUrl={b.user.avatarStaticUrl} size={28} />
              <div className="flex-1 text-sm">{b.user.displayName}</div>
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => zz.attempt(() => zz.api.channelUnban(channelId, b.user.id)).then(load)}>
                Unban
              </Button>
            </div>
          ))
        )}
      </div>
    );
  }
}

/** Set sessions can have a picture (owner and mods). Temporary ones keep their initials. */
function PictureSetting({ s }: { s: SessionDTO }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: File | null) => {
    if (f && f.size > PROFILE_IMAGE_MAX_BYTES) return zz.notify('Images can be at most 10 MB', 'error');
    setBusy(true);
    const ok = await zz.attempt(() => zz.setSessionIcon(s.id, f, f?.type));
    setBusy(false);
    if (ok) zz.notify(f ? 'Session picture updated' : 'Session picture removed', 'success');
  };
  return (
    <div className="flex items-center gap-4 rounded-lg bg-side p-3">
      <SessionPicture s={s} className="size-16 rounded-2xl text-xl" animate />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Session picture</div>
        <p className="text-xs text-muted">{s.isSet ? 'PNG, JPEG, WebP or GIF, up to 10 MB. Shown in everyone’s session list.' : 'Only set sessions can have a picture.'}</p>
      </div>
      {s.isSet && (
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : s.iconUrl ? 'Change' : 'Upload'}
          </Button>
          {s.iconUrl && (
            <Button variant="secondary" disabled={busy} onClick={() => run(null)}>
              Remove
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) run(f);
            }}
          />
        </div>
      )}
    </div>
  );
}
