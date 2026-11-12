import { PROFILE_IMAGE_MAX_BYTES, STATUSES, type UserStatus } from '@zirzircord/shared';
import { Copy } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { SOUND_GROUPS, type SoundGroup } from '@zirzircord/client-core';
import { Play } from 'lucide-react';
import { useStore } from 'zustand';
import { Avatar, Banner, Button, Field, Modal, Toggle, ToggleRow, cx, inputCls } from '../components/ui';
import { sounds } from '../lib/sounds';
import { copyText } from '../lib/format';
import { call, closeModal, ui, useApp, useCall, useUi, zz } from '../lib/zz';

type Tab = 'profile' | 'account' | 'voice' | 'sounds';

export function UserSettingsModal() {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <Modal title="User settings" onClose={closeModal} wide>
      <div className="flex flex-col gap-4 md:flex-row">
        <nav className="flex shrink-0 gap-1 md:w-40 md:flex-col">
          {(
            [
              ['profile', 'Profile'],
              ['account', 'Account'],
              ['voice', 'Voice & video'],
              ['sounds', 'Sounds'],
            ] as [Tab, string][]
          ).map(([t, l]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx('rounded-md px-3 py-2 text-left text-sm whitespace-nowrap', tab === t ? 'bg-field text-fg' : 'text-muted hover:bg-hover')}
            >
              {l}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'profile' && <Profile />}
          {tab === 'account' && <Account />}
          {tab === 'voice' && <VoiceSettings />}
          {tab === 'sounds' && <SoundSettings />}
        </div>
      </div>
    </Modal>
  );
}

function Profile() {
  const me = useApp((s) => s.me!);
  const [name, setName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [color, setColor] = useState(me.bannerColor);
  const [status, setStatus] = useState<UserStatus>(me.status);
  const fileRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'avatar' | 'banner' | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await zz.attempt(() => zz.updateProfile({ displayName: name.trim(), bio, bannerColor: color, status }))) zz.notify('Profile saved', 'success');
  };
  const upload = async (kind: 'avatar' | 'banner', f: File | undefined) => {
    if (!f) return;
    if (f.size > PROFILE_IMAGE_MAX_BYTES) return zz.notify('Images can be at most 10 MB', 'error');
    setBusy(kind);
    const ok = await zz.attempt(() => (kind === 'avatar' ? zz.uploadAvatar(f, f.type) : zz.uploadBanner(f, f.type)));
    setBusy(null);
    if (ok) zz.notify(kind === 'avatar' ? 'Avatar updated' : 'Banner updated', 'success');
  };
  const accept = 'image/png,image/jpeg,image/webp,image/gif';
  return (
    <form onSubmit={save} className="space-y-4">
      <div className="overflow-hidden rounded-xl bg-side">
        <div className="group relative">
          <Banner user={{ ...me, bannerColor: color }} height={110} animate />
          <div className="absolute top-2 right-2 flex gap-1.5">
            <Button type="button" variant="secondary" className="bg-black/60 px-2.5 py-1 text-xs" onClick={() => bannerRef.current?.click()} disabled={busy === 'banner'}>
              {busy === 'banner' ? 'Uploading…' : me.bannerUrl ? 'Change banner' : 'Upload banner'}
            </Button>
            {me.bannerUrl && (
              <Button type="button" variant="secondary" className="bg-black/60 px-2.5 py-1 text-xs" onClick={() => zz.attempt(() => zz.updateProfile({ bannerUploadId: null }))}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-end gap-3 px-4 pb-3">
          <button type="button" className="-mt-8 rounded-full border-4 border-side" onClick={() => fileRef.current?.click()} title="Change avatar">
            <Avatar name={name || me.displayName} url={me.avatarUrl} staticUrl={me.avatarStaticUrl} size={72} animate />
          </button>
          <div className="pb-1">
            <div className="font-semibold">{name}</div>
            <button
              type="button"
              className="flex items-center gap-1 font-mono text-xs text-muted hover:text-fg"
              onClick={async () => (await copyText(me.publicId)) && zz.notify('ID copied', 'success')}
            >
              {me.publicId} <Copy size={11} />
            </button>
          </div>
          <div className="ml-auto flex gap-2 pb-1">
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => fileRef.current?.click()} disabled={busy === 'avatar'}>
              {busy === 'avatar' ? 'Uploading…' : 'Change avatar'}
            </Button>
            {me.avatarUrl && (
              <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => zz.attempt(() => zz.updateProfile({ avatarUploadId: null }))}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <p className="px-4 pb-3 text-xs text-faint">
          PNG, JPG, WebP or <b>GIF</b> (up to 10 MB). Animated avatars move when you talk in voice, when someone hovers them, and on your profile card.
        </p>
        <input ref={fileRef} type="file" accept={accept} hidden onChange={(e) => (upload('avatar', e.target.files?.[0]), (e.target.value = ''))} />
        <input ref={bannerRef} type="file" accept={accept} hidden onChange={(e) => (upload('banner', e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      <Field label="Display name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required />
      </Field>
      <Field label="About me">
        <textarea className={`${inputCls} resize-none`} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Banner color (when no image)">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-full cursor-pointer rounded-md bg-rail" />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as UserStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {{ ONLINE: 'Online', IDLE: 'Idle', DND: 'Do not disturb', INVISIBLE: 'Invisible' }[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button>Save profile</Button>
    </form>
  );
}

function Account() {
  const me = useApp((s) => s.me!);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const upgrade = async (e: FormEvent) => {
    e.preventDefault();
    if ((await zz.attempt(() => zz.upgrade(email, password))) !== undefined) zz.notify('Account created — your ID stays the same', 'success');
  };
  return (
    <div className="space-y-5">
      {me.isGuest ? (
        <form onSubmit={upgrade} className="space-y-3 rounded-lg bg-side p-4">
          <div>
            <div className="font-semibold">You are a guest</div>
            <p className="text-sm text-muted">
              Guest identities live on this device only. Create an account to keep <span className="font-mono">{me.publicId}</span>, sign in elsewhere and own set sessions.
            </p>
          </div>
          <Field label="Email">
            <input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button>Create account</Button>
        </form>
      ) : (
        <div className="rounded-lg bg-side p-4 text-sm">
          <div className="text-xs font-bold text-muted">EMAIL (PRIVATE)</div>
          {me.email}
        </div>
      )}
      <Button variant="danger" onClick={() => (closeModal(), zz.logout())}>
        Log out
      </Button>
    </div>
  );
}

function VoiceSettings() {
  const c = useCall((c) => ({
    ptt: c.pttMode,
    ns: c.noiseSuppression,
    input: c.inputDeviceId,
    output: c.outputDeviceId,
  }));
  const pttKey = useUi((u) => u.pttKey);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [binding, setBinding] = useState(false);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
  }, []);

  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      ui.setState({ pttKey: e.code });
      try {
        localStorage.setItem('zz.pttKey', e.code);
      } catch {}
      if (call.state.pttMode) window.zirzirDesktop?.setPttKey(e.code);
      setBinding(false);
    };
    window.addEventListener('keydown', onKey, { once: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [binding]);

  // Mic test meter
  useEffect(() => {
    if (!testing) return;
    let stop = false;
    let stream: MediaStream | undefined;
    let ctx: AudioContext | undefined;
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: c.input ?? undefined, noiseSuppression: c.ns === 'browser' } });
      setDevices(await navigator.mediaDevices.enumerateDevices());
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (stop) return;
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 90));
        requestAnimationFrame(tick);
      };
      tick();
    })().catch(() => zz.notify('Microphone permission denied', 'error'));
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  }, [testing, c.input, c.ns]);

  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Input device">
          <select className={inputCls} value={c.input ?? 'default'} onChange={(e) => call.setDevice('audioinput', e.target.value)}>
            {inputs.length === 0 && <option value="default">Default</option>}
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Output device">
          <select className={inputCls} value={c.output ?? 'default'} onChange={(e) => call.setDevice('audiooutput', e.target.value)} disabled={outputs.length === 0}>
            {outputs.length === 0 && <option value="default">System default</option>}
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Speaker'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="space-y-2">
        <Button variant="secondary" onClick={() => setTesting((t) => !t)}>
          {testing ? 'Stop mic test' : "Let's check — mic test"}
        </Button>
        {testing && (
          <div className="h-2 overflow-hidden rounded bg-line">
            <div className={cx('h-full transition-all duration-75', level > 0.8 ? 'bg-danger' : 'bg-ok')} style={{ width: `${level * 100}%` }} />
          </div>
        )}
      </div>
      <Field label="Noise suppression" hint="RNNoise is an AI filter that removes keyboard, fan and background noise. Uses a bit more CPU.">
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              ['rnnoise', 'AI (RNNoise)'],
              ['browser', 'Standard'],
              ['off', 'Off'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              onClick={() => call.setNoiseSuppression(v)}
              className={cx('rounded-md border px-2 py-2 text-sm', c.ns === v ? 'border-brand bg-brand/10' : 'border-line')}
            >
              {l}
            </button>
          ))}
        </div>
      </Field>
      <div className="divide-y divide-line">
        <ToggleRow
          title="Push to talk"
          desc={window.zirzirDesktop ? 'Works even when ZirZirCord is in the background.' : 'Works while this tab is focused. Use the desktop app for a global key.'}
          checked={c.ptt}
          onChange={(v) => call.setPttMode(v)}
        />
      </div>
      {c.ptt && (
        <Field label="Push-to-talk key">
          <Button variant="secondary" onClick={() => setBinding(true)} className="font-mono">
            {binding ? 'Press any key…' : pttKey}
          </Button>
        </Field>
      )}
    </div>
  );
}

function SoundSettings() {
  const prefs = useStore(sounds.store);
  return (
    <div className="space-y-4">
      <ToggleRow title="Sound effects" desc="Join/leave chimes, message sounds and pings." checked={prefs.enabled} onChange={(v) => sounds.update({ enabled: v })} />
      <Field label={`Volume · ${Math.round(prefs.volume * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={prefs.volume}
          disabled={!prefs.enabled}
          onChange={(e) => sounds.update({ volume: Number(e.target.value) })}
          onPointerUp={() => sounds.preview('message')}
          className="w-full accent-brand disabled:opacity-40"
        />
      </Field>
      <div className={cx('divide-y divide-line rounded-lg bg-side px-3', !prefs.enabled && 'pointer-events-none opacity-40')}>
        {(Object.keys(SOUND_GROUPS) as SoundGroup[]).map((g) => (
          <div key={g} className="flex items-center gap-3 py-2.5">
            <button
              type="button"
              onClick={() => sounds.preview(SOUND_GROUPS[g].preview)}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-field text-muted hover:text-fg"
              aria-label={`Preview: ${SOUND_GROUPS[g].label}`}
              title="Preview"
            >
              <Play size={14} />
            </button>
            <span className="flex-1 text-sm">{SOUND_GROUPS[g].label}</span>
            <Toggle checked={prefs.groups[g]} onChange={(v) => sounds.update({ groups: { [g]: v } })} />
          </div>
        ))}
      </div>
      <p className="text-xs text-faint">
        Message sounds follow each session's notification settings (a muted session or channel stays silent). Do Not Disturb silences message
        and ping sounds. Settings are saved on this device.
      </p>
    </div>
  );
}
