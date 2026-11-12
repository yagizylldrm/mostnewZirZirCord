import { X } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useState } from 'react';
import { colorFor, initials } from '../lib/format';
import { useApp, zz } from '../lib/zz';

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-brand text-white hover:brightness-110',
    secondary: 'bg-field text-fg hover:bg-line',
    danger: 'bg-danger text-white hover:brightness-110',
    ghost: 'text-muted hover:text-fg hover:bg-hover',
  };
  return (
    <button
      {...p}
      className={cx('rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50', styles[variant], className)}
    />
  );
}

export function IconButton({
  label,
  active,
  danger,
  className,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; danger?: boolean }) {
  return (
    <button
      {...p}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        'grid size-8 place-items-center rounded-md transition',
        danger ? 'text-danger hover:bg-danger/15' : active ? 'bg-hover text-fg' : 'text-muted hover:bg-hover hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-md bg-rail px-3 py-2 text-sm text-fg placeholder:text-faint outline-none focus:ring-2 focus:ring-brand/60';

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 shrink-0 rounded-full transition disabled:opacity-40', checked ? 'bg-ok' : 'bg-line')}
    >
      <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function ToggleRow({ title, desc, ...t }: { title: string; desc?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-muted">{desc}</div>}
      </div>
      <Toggle {...t} />
    </div>
  );
}

export function Avatar({
  name,
  url,
  staticUrl,
  size = 40,
  status,
  speaking,
  animate,
  className,
}: {
  name: string;
  /** Animated version (GIF avatars) — used while hovered, speaking, or when `animate`. */
  url?: string | null;
  /** Still first frame — used the rest of the time. */
  staticUrl?: string | null;
  size?: number;
  status?: string | null;
  speaking?: boolean;
  animate?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState(false);
  const dot = status && status !== 'INVISIBLE' ? { ONLINE: 'bg-ok', IDLE: 'bg-warn', DND: 'bg-danger' }[status] : null;
  const src = animate || hover || speaking ? url : (staticUrl ?? url);
  return (
    <div
      className={cx('relative shrink-0', speaking && 'avatar-speaking', className)}
      style={{ width: size, height: size }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {src ? (
        <img src={src} alt="" className={cx('size-full rounded-full object-cover', speaking && 'speaking-ring')} draggable={false} />
      ) : (
        <div
          className={cx('grid size-full place-items-center rounded-full font-semibold text-white', speaking && 'speaking-ring')}
          style={{ background: colorFor(name), fontSize: size * 0.38 }}
        >
          {initials(name)}
        </div>
      )}
      {dot && (
        <span
          className={cx('absolute -right-0.5 -bottom-0.5 rounded-full border-[3px] border-side', dot)}
          style={{ width: Math.max(10, size * 0.36), height: Math.max(10, size * 0.36) }}
        />
      )}
    </div>
  );
}

/** Profile banner: image/GIF if set (animated only when `animate`), otherwise the banner color. */
export function Banner({ user, height, animate, className }: { user: { bannerUrl: string | null; bannerStaticUrl: string | null; bannerColor: string }; height: number; animate?: boolean; className?: string }) {
  const src = animate ? user.bannerUrl : (user.bannerStaticUrl ?? user.bannerUrl);
  return src ? (
    <img src={src} alt="" className={cx('w-full object-cover', className)} style={{ height }} draggable={false} />
  ) : (
    <div className={cx('w-full', className)} style={{ height, background: user.bannerColor }} />
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx('flex max-h-[92vh] w-full flex-col overflow-hidden rounded-xl bg-main shadow-2xl', wide ? 'max-w-3xl' : 'max-w-md')}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 bg-side px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const notices = useApp((s) => s.notices);
  return (
    <div className="pointer-events-none fixed top-3 left-1/2 z-[70] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {notices.map((n) => (
        <div
          key={n.id}
          className={cx(
            'pointer-events-auto rounded-lg px-4 py-2.5 text-sm shadow-lg',
            n.kind === 'error' ? 'bg-danger text-white' : n.kind === 'success' ? 'bg-ok text-white' : 'bg-elev text-fg',
          )}
          onClick={() => zz.store.setState((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) }))}
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  if (role === 'OWNER') return <span className="rounded bg-owner/15 px-1.5 py-0.5 text-[10px] font-bold text-owner">OWNER</span>;
  if (role === 'MOD') return <span className="rounded bg-mod/15 px-1.5 py-0.5 text-[10px] font-bold text-mod">MOD</span>;
  return null;
}

export function Logo({ size = 40 }: { size?: number }) {
  return <img src="./logo.svg" width={size} height={size} alt="ZirZirCord" draggable={false} />;
}
