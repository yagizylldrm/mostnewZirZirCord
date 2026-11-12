import type { NotifyLevel } from '@zirzircord/shared';
import { isSessionMuted } from '@zirzircord/client-core';
import { Pressable, Text, View } from 'react-native';
import { Btn, Sheet } from '../components/ui';
import { C, s } from '../theme';
import { useApp, zz } from '../zz';

const LEVELS: { value: NotifyLevel; title: string; desc: string }[] = [
  { value: 'ALL', title: 'All messages', desc: 'Every new message.' },
  { value: 'MENTIONS', title: 'Only @mentions', desc: 'When someone @mentions you or uses @everyone.' },
  { value: 'NONE', title: 'Nothing', desc: 'Never. Unread badges still show.' },
];
const MUTE_FOR: { label: string; minutes: number | null }[] = [
  { label: '15 minutes', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '8 hours', minutes: 480 },
  { label: '24 hours', minutes: 1440 },
  { label: 'Until I turn it back on', minutes: null },
];

export function NotificationSheet({ sessionId, visible, onClose }: { sessionId: string; visible: boolean; onClose: () => void }) {
  const { notify, muted } = useApp((st) => ({ notify: st.notify[sessionId], muted: isSessionMuted(st, sessionId) }));
  const level = notify?.level ?? 'ALL';
  const until = notify?.mutedUntil;
  const forever = !!until && new Date(until).getFullYear() > 9000;
  const update = (input: Parameters<typeof zz.setSessionNotify>[1]) => zz.attempt(() => zz.setSessionNotify(sessionId, input));

  return (
    <Sheet visible={visible} title="Notifications" onClose={onClose}>
      <Text style={s.label}>Mute session</Text>
      {muted ? (
        <View style={[s.card, s.row, { gap: 10 }]}>
          <Text style={[s.text, s.flex]}>🔕 Muted {forever ? 'until you turn it back on' : `until ${new Date(until!).toLocaleString()}`}</Text>
          <Btn variant="secondary" title="Unmute" onPress={() => update({ mutedUntil: null })} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {MUTE_FOR.map((m) => (
            <Pressable
              key={m.label}
              onPress={() => update({ mutedUntil: new Date(m.minutes === null ? Date.UTC(9999, 0, 1) : Date.now() + m.minutes * 60_000).toISOString() })}
              style={{ backgroundColor: C.side, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 }}
            >
              <Text style={s.text}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={s.muted}>While muted you get no alerts from this session, not even @mentions.</Text>
      <Text style={[s.label, { marginTop: 10 }]}>Notify me about</Text>
      {LEVELS.map((l) => (
        <Pressable
          key={l.value}
          onPress={() => update({ level: l.value })}
          style={{ borderWidth: 1, borderColor: level === l.value ? C.brand : C.line, backgroundColor: level === l.value ? C.brand + '1a' : 'transparent', borderRadius: 10, padding: 12 }}
        >
          <Text style={[s.text, { fontWeight: '600' }]}>{l.title}</Text>
          <Text style={s.muted}>{l.desc}</Text>
        </Pressable>
      ))}
      <Text style={s.muted}>Tip: long-press a channel to mute just that channel.</Text>
    </Sheet>
  );
}
