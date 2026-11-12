import { StyleSheet } from 'react-native';

export const C = {
  rail: '#111214',
  side: '#1b1c1f',
  main: '#26272b',
  field: '#34363b',
  elev: '#18191c',
  line: '#3a3c42',
  fg: '#e3e5e8',
  muted: '#9a9fa8',
  faint: '#6d717a',
  brand: '#ff7a2f',
  brand2: '#ffb02e',
  ok: '#23a55a',
  warn: '#f0b232',
  danger: '#f23f43',
  owner: '#f5c542',
  mod: '#43c37a',
};

export const s = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  h1: { color: C.fg, fontSize: 24, fontWeight: '700' },
  h2: { color: C.fg, fontSize: 17, fontWeight: '600' },
  label: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  text: { color: C.fg, fontSize: 15 },
  muted: { color: C.muted, fontSize: 13 },
  input: { backgroundColor: C.rail, color: C.fg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  card: { backgroundColor: C.side, borderRadius: 12, padding: 14 },
  mono: { fontFamily: 'Menlo', color: C.fg },
});

export function colorFor(str: string) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360}, 55%, 45%)`;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

export function formatDuration(ms: number) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
