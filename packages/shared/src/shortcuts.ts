/** In-app keyboard shortcuts: ids, defaults and the pure helpers for matching and editing key combos. */

export type ShortcutId = 'toggleMic' | 'toggleDeafen' | 'toggleCamera' | 'toggleMembers';

/** A key (KeyboardEvent.code, so it ignores layout and Option/Alt characters) plus modifiers. */
export interface Combo {
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export type Bindings = Record<ShortcutId, Combo | null>;

export const SHORTCUTS: Record<ShortcutId, { label: string; default: Combo }> = {
  toggleMic: { label: 'Mute / unmute microphone', default: { code: 'KeyM', alt: true } },
  toggleDeafen: { label: 'Deafen / undeafen', default: { code: 'KeyH', alt: true } },
  toggleCamera: { label: 'Camera on / off', default: { code: 'KeyC', alt: true } },
  toggleMembers: { label: 'Show / hide member list', default: { code: 'KeyU', alt: true } },
};

export const SHORTCUT_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

export const defaultBindings = (): Bindings =>
  Object.fromEntries(SHORTCUT_IDS.map((id) => [id, { ...SHORTCUTS[id].default }])) as Bindings;

/** The bits of a KeyboardEvent we read (this package has no DOM types). */
export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/**
 * The combo a key press stands for, or null when it can't be a shortcut: a lone
 * modifier, or no modifier at all (a bare letter would fire while typing a message).
 */
export function comboFromEvent(e: KeyEventLike): Combo | null {
  if (!e.code || MODIFIER_CODES.test(e.code)) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  const c: Combo = { code: e.code };
  if (e.ctrlKey) c.ctrl = true;
  if (e.altKey) c.alt = true;
  if (e.shiftKey) c.shift = true;
  if (e.metaKey) c.meta = true;
  return c;
}

export function sameCombo(a: Combo | null | undefined, b: Combo | null | undefined): boolean {
  if (!a || !b) return false;
  return a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta;
}

/** Which shortcut (other than `except`) already uses this combo. */
export function findConflict(bindings: Bindings, combo: Combo, except?: ShortcutId): ShortcutId | null {
  return SHORTCUT_IDS.find((id) => id !== except && sameCombo(bindings[id], combo)) ?? null;
}

/** The shortcut a key press triggers, if any. */
export function matchShortcut(bindings: Bindings, e: KeyEventLike): ShortcutId | null {
  const c = comboFromEvent(e);
  if (!c) return null;
  return SHORTCUT_IDS.find((id) => sameCombo(bindings[id], c)) ?? null;
}

const KEY_NAMES: Record<string, string> = { Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Space: 'Space' };

/** "Alt+M", "Ctrl+Shift+4", … (⌘/⌥ symbols are left to the UI: `mac` swaps the names). */
export function formatCombo(c: Combo, mac = false): string {
  const key = KEY_NAMES[c.code] ?? c.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '');
  const parts = [c.ctrl && 'Ctrl', c.alt && (mac ? 'Option' : 'Alt'), c.shift && 'Shift', c.meta && (mac ? 'Cmd' : 'Win'), key];
  return parts.filter(Boolean).join('+');
}

/** Reads stored bindings, falling back to the defaults for anything missing or malformed. */
export function parseBindings(raw: string | null | undefined): Bindings {
  const out = defaultBindings();
  if (!raw) return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!data || typeof data !== 'object') return out;
  for (const id of SHORTCUT_IDS) {
    if (!(id in data)) continue;
    const v = (data as Record<string, unknown>)[id];
    if (v === null) out[id] = null; // deliberately unbound
    else if (v && typeof v === 'object' && typeof (v as Combo).code === 'string') {
      const c = v as Combo;
      out[id] = { code: c.code, ...(c.ctrl && { ctrl: true }), ...(c.alt && { alt: true }), ...(c.shift && { shift: true }), ...(c.meta && { meta: true }) };
    }
  }
  return out;
}
