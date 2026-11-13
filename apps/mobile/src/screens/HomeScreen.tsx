import { sessionUnread, sleepLabel } from '@zirzircord/client-core';
import { formatSessionCode, type SessionDTO } from '@zirzircord/shared';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Btn, SessionPicture, Sheet, ToggleRow } from '../components/ui';
import { C, s } from '../theme';
import { useApp, zz } from '../zz';
import { UserSettingsSheet } from './UserSettingsSheet';

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { me, setSessions, openSessions, sessions, unreadKey } = useApp((st) => ({
    me: st.me!,
    setSessions: st.sidebar.setSessions,
    openSessions: st.sidebar.openSessions,
    sessions: st.sessions,
    unreadKey: JSON.stringify(Object.keys(st.sessions).map((sid) => [sid, sessionUnread(st, sid).mentions])),
  }));
  const unreadBy: Record<string, number> = Object.fromEntries(JSON.parse(unreadKey));
  const [create, setCreate] = useState(false);
  const [join, setJoin] = useState(false);
  const [settings, setSettings] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const inside = Object.values(sessions);

  return (
    <View style={{ flex: 1, backgroundColor: C.main, paddingTop: insets.top }}>
      <View style={[s.row, { padding: 16, gap: 12 }]}>
        <Pressable onPress={() => setSettings(true)}>
          <Avatar name={me.displayName} url={me.avatarUrl} staticUrl={me.avatarStaticUrl} size={44} status={me.status} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.h2}>Hey {me.displayName}!</Text>
          <Text style={[s.muted, { fontFamily: 'Menlo' }]}>{me.publicId}</Text>
        </View>
        <Pressable onPress={() => setSettings(true)} hitSlop={10}>
          <Text style={{ fontSize: 22 }}>⚙️</Text>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} onRefresh={async () => (setRefreshing(true), await zz.refreshSidebar(), setRefreshing(false))} />}
      >
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title="＋ Create session" onPress={() => setCreate(true)} style={{ flex: 1, backgroundColor: C.ok }} />
          <Btn title="→ Join with code" onPress={() => setJoin(true)} style={{ flex: 1 }} />
        </View>

        {inside.length > 0 && (
          <Section title="Your open sessions">
            {inside.map((v) => (
              <SessionRow
                key={v.session.id}
                session={v.session}
                name={v.session.name}
                sub={`${v.presence.present.length} online · ${formatSessionCode(v.session.code)}`}
                action="Open"
                badge={unreadBy[v.session.id]}
                onPress={() => zz.setActiveSession(v.session.id)}
              />
            ))}
          </Section>
        )}
        {openSessions.filter((i) => !sessions[i.session.id]).length > 0 && (
          <Section title="Still running">
            {openSessions
              .filter((i) => !sessions[i.session.id])
              .map((i) => (
                <SessionRow key={i.session.id} session={i.session} name={i.session.name} sub={`${i.presentCount} online`} action="Rejoin" onPress={() => zz.attempt(() => zz.openSession(i.session.id))} />
              ))}
          </Section>
        )}
        <Section title="Set sessions">
          {setSessions.length === 0 ? (
            <Text style={s.muted}>Permanent sessions you've visited show up here. Open one any time — if nobody is there, you start hosting it.</Text>
          ) : (
            setSessions.map((i) => (
              <SessionRow
                key={i.session.id}
                session={i.session}
                name={(i.session.ownerId === me.id ? '👑 ' : '') + i.session.name}
                sub={sleepLabel(i.session)?.text ?? (i.live ? `● Live · ${i.presentCount} online` : 'Nobody here right now')}
                subColor={sleepLabel(i.session)?.urgent ? C.warn : undefined}
                action={sessions[i.session.id] ? 'Open' : i.live ? 'Join' : 'Start hosting'}
                onPress={() => zz.attempt(() => zz.openSession(i.session.id))}
              />
            ))
          )}
        </Section>
      </ScrollView>
      <CreateSheet visible={create} onClose={() => setCreate(false)} />
      <JoinSheet visible={join} onClose={() => setJoin(false)} />
      <UserSettingsSheet visible={settings} onClose={() => setSettings(false)} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{title}</Text>
      {children}
    </View>
  );
}

function SessionRow({
  session,
  name,
  sub,
  subColor,
  action,
  badge,
  onPress,
}: {
  session: SessionDTO;
  name: string;
  sub: string;
  subColor?: string;
  action: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.card, s.row, { gap: 12 }]}>
      <View style={{ opacity: session.sleepingSince ? 0.6 : 1 }}>
        <SessionPicture session={session} />
      </View>
      <View style={s.flex}>
        <Text style={[s.text, { fontWeight: '600' }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[s.muted, subColor ? { color: subColor, fontWeight: '600' } : null]}>{sub}</Text>
      </View>
      {!!badge && (
        <View style={{ backgroundColor: C.danger, borderRadius: 10, paddingHorizontal: 7, minWidth: 20, alignItems: 'center' }}>
          <Text style={{ color: 'white', fontWeight: '800', fontSize: 12 }}>{badge}</Text>
        </View>
      )}
      <Text style={{ color: C.brand, fontWeight: '700' }}>{action}</Text>
    </Pressable>
  );
}

function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const me = useApp((st) => st.me!);
  const [name, setName] = useState('');
  const [isSet, setIsSet] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible={visible} title="Create a session" onClose={onClose}>
      <TextInput style={s.input} placeholder={`${me.displayName}'s session`} placeholderTextColor={C.faint} value={name} onChangeText={setName} maxLength={48} />
      <ToggleRow title="Set session" desc={me.isGuest ? 'Create an account to make permanent sessions.' : 'Stays available after everyone leaves.'} value={isSet} onChange={setIsSet} disabled={me.isGuest} />
      <Btn
        title="Create"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          const ok = await zz.attempt(() => zz.createSession(name.trim() || `${me.displayName}'s session`, isSet));
          setBusy(false);
          if (ok) onClose();
        }}
      />
    </Sheet>
  );
}

function JoinSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible={visible} title="Join a session" onClose={onClose}>
      <TextInput
        style={[s.input, { fontSize: 26, textAlign: 'center', letterSpacing: 6, fontFamily: 'Menlo' }]}
        placeholder="XXXX-XXXX"
        placeholderTextColor={C.faint}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
        autoFocus
      />
      <Btn
        title="Join"
        busy={busy}
        disabled={code.replace(/[\s-]/g, '').length !== 8}
        onPress={async () => {
          setBusy(true);
          const ok = await zz.attempt(() => zz.joinByCode(code));
          setBusy(false);
          if (ok) (setCode(''), onClose());
        }}
      />
    </Sheet>
  );
}
