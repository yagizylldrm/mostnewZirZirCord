import { describe, expect, it } from 'vitest';
import { comboFromEvent, defaultBindings, findConflict, formatCombo, matchShortcut, parseBindings, sameCombo } from '..';

const ev = (code: string, m: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...m,
});

describe('shortcuts', () => {
  it('needs a non-modifier key and at least one of ctrl/alt/meta', () => {
    expect(comboFromEvent(ev('KeyM'))).toBeNull();
    expect(comboFromEvent(ev('KeyM', { shiftKey: true }))).toBeNull();
    expect(comboFromEvent(ev('AltLeft', { altKey: true }))).toBeNull();
    expect(comboFromEvent(ev('KeyM', { altKey: true }))).toEqual({ code: 'KeyM', alt: true });
  });

  it('matches the default bindings and nothing else', () => {
    const b = defaultBindings();
    expect(matchShortcut(b, ev('KeyM', { altKey: true }))).toBe('toggleMic');
    expect(matchShortcut(b, ev('KeyM', { altKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(b, ev('KeyM', { ctrlKey: true }))).toBeNull();
  });

  it('finds conflicts but ignores the shortcut being edited', () => {
    const b = defaultBindings();
    expect(findConflict(b, { code: 'KeyH', alt: true })).toBe('toggleDeafen');
    expect(findConflict(b, { code: 'KeyH', alt: true }, 'toggleDeafen')).toBeNull();
    expect(sameCombo(null, null)).toBe(false);
  });

  it('formats combos', () => {
    expect(formatCombo({ code: 'KeyM', alt: true })).toBe('Alt+M');
    expect(formatCombo({ code: 'Digit4', ctrl: true, shift: true })).toBe('Ctrl+Shift+4');
    expect(formatCombo({ code: 'KeyM', alt: true, meta: true }, true)).toBe('Option+Cmd+M');
  });

  it('parses stored bindings defensively', () => {
    const d = defaultBindings();
    expect(parseBindings(null)).toEqual(d);
    expect(parseBindings('not json')).toEqual(d);
    const p = parseBindings(JSON.stringify({ toggleMic: { code: 'KeyZ', ctrl: true }, toggleDeafen: null, toggleCamera: 5 }));
    expect(p.toggleMic).toEqual({ code: 'KeyZ', ctrl: true });
    expect(p.toggleDeafen).toBeNull();
    expect(p.toggleCamera).toEqual(d.toggleCamera);
  });
});
