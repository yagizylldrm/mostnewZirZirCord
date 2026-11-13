import { Image } from 'expo-image';
import { type ReactNode, useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, ScrollView, Switch, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, colorFor, initials, s } from '../theme';
import { useApp, zz } from '../zz';

export function Avatar({
  name,
  url,
  staticUrl,
  size = 40,
  speaking,
  status,
  animate,
}: {
  name: string;
  /** Animated version (GIF avatars) — shown while speaking or when `animate`. */
  url?: string | null;
  /** Still first frame — shown the rest of the time. */
  staticUrl?: string | null;
  size?: number;
  speaking?: boolean;
  status?: string | null;
  animate?: boolean;
}) {
  // Avatars "move while speaking": a gentle bounce loop.
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!speaking) {
      scale.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [speaking, scale]);
  const ring = speaking ? { borderWidth: 2, borderColor: C.ok } : null;
  const dot = status && status !== 'INVISIBLE' ? ({ ONLINE: C.ok, IDLE: C.warn, DND: C.danger } as Record<string, string>)[status] : null;
  const src = animate || speaking ? url : (staticUrl ?? url);
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale }] }}>
      {src ? (
        <Image source={{ uri: src }} style={[{ width: size, height: size, borderRadius: size / 2 }, ring]} />
      ) : (
        <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: colorFor(name), alignItems: 'center', justifyContent: 'center' }, ring]}>
          <Text style={{ color: 'white', fontWeight: '700', fontSize: size * 0.38 }}>{initials(name)}</Text>
        </View>
      )}
      {dot && (
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: size * 0.34, height: size * 0.34, borderRadius: size, backgroundColor: dot, borderWidth: 2, borderColor: C.side }} />
      )}
    </Animated.View>
  );
}

/** Profile banner: image/GIF when set, otherwise the banner color. */
export function Banner({ user, height }: { user: { bannerUrl: string | null; bannerColor: string }; height: number }) {
  return user.bannerUrl ? (
    <Image source={{ uri: user.bannerUrl }} style={{ height, borderRadius: 12 }} contentFit="cover" />
  ) : (
    <View style={{ height, borderRadius: 12, backgroundColor: user.bannerColor }} />
  );
}

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Btn({ title, onPress, variant = 'primary', disabled, busy, style, icon }: { title?: string; onPress?: () => void; variant?: BtnVariant; disabled?: boolean; busy?: boolean; style?: ViewStyle; icon?: ReactNode }) {
  const bg = { primary: C.brand, secondary: C.field, danger: C.danger, ghost: 'transparent' }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color="white" /> : icon}
      {title ? <Text style={{ color: variant === 'ghost' ? C.muted : 'white', fontWeight: '600', fontSize: 15 }}>{title}</Text> : null}
    </Pressable>
  );
}

export function RoundBtn({ icon, onPress, active, danger, off, size = 52, label }: { icon: ReactNode; onPress: () => void; active?: boolean; danger?: boolean; off?: boolean; size?: number; label: string }) {
  const bg = danger ? C.danger : off ? '#ffffff' : active ? C.ok : C.field;
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 })}>
      {icon}
    </Pressable>
  );
}

export function ToggleRow({ title, desc, value, onChange, disabled }: { title: string; desc?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[s.row, { paddingVertical: 10, gap: 12 }]}>
      <View style={s.flex}>
        <Text style={s.text}>{title}</Text>
        {desc ? <Text style={s.muted}>{desc}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: C.ok, false: C.line }} />
    </View>
  );
}

export function RoleBadge({ role }: { role: string }) {
  if (role !== 'OWNER' && role !== 'MOD') return null;
  const color = role === 'OWNER' ? C.owner : C.mod;
  return (
    <View style={{ backgroundColor: color + '26', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Text style={{ color, fontSize: 10, fontWeight: '800' }}>{role}</Text>
    </View>
  );
}

/** Full-screen sheet used for settings/modals. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Android draws the modal edge to edge (under the status bar); iOS sheets have their own inset. */}
      <View style={{ flex: 1, backgroundColor: C.main, paddingTop: 12 + (Platform.OS === 'android' ? insets.top : 0) }}>
        <View style={[s.row, { paddingHorizontal: 16, paddingBottom: 8 }]}>
          <Text style={[s.h2, s.flex]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: C.brand, fontSize: 16, fontWeight: '600' }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Toasts() {
  const notices = useApp((st) => st.notices);
  const insets = useSafeAreaInsets();
  if (!notices.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, gap: 6 }}>
      {notices.map((n) => (
        <Pressable
          key={n.id}
          onPress={() => zz.store.setState((st) => ({ notices: st.notices.filter((x) => x.id !== n.id) }))}
          style={{ backgroundColor: n.kind === 'error' ? C.danger : n.kind === 'success' ? C.ok : C.elev, borderRadius: 10, padding: 12 }}
        >
          <Text style={{ color: 'white' }}>{n.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Icon({ name, size = 22, color = C.fg }: { name: keyof typeof glyphs; size?: number; color?: string }) {
  return <Text style={{ fontSize: size, color, lineHeight: size * 1.15 }}>{glyphs[name]}</Text>;
}
/** Emoji/unicode glyph icons keep the app free of extra native icon packages. */
const glyphs = {
  mic: '🎙️', micOff: '🔇', headphones: '🎧', deaf: '🙉', camera: '📷', screen: '🖥️', leave: '📵', send: '➤', attach: '＋',
  hash: '#', voice: '🔊', crown: '👑', settings: '⚙️', members: '👥', back: '‹', close: '✕', play: '▶', pause: '❚❚', file: '📄', menu: '☰', speaker: '🔈',
};

/** A session's picture (set sessions) or its coloured initials. */
export function SessionPicture({ session, size = 42 }: { session: { id: string; name: string; iconUrl: string | null; iconStaticUrl: string | null }; size?: number }) {
  const radius = Math.round(size * 0.28);
  if (session.iconUrl) return <Image source={{ uri: session.iconStaticUrl ?? session.iconUrl }} style={{ width: size, height: size, borderRadius: radius }} contentFit="cover" />;
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: colorFor(session.id), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: 'white', fontWeight: '700', fontSize: size * 0.36 }}>{initials(session.name)}</Text>
    </View>
  );
}
