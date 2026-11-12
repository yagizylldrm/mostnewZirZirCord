import { can, type BanDTO } from '@zirzircord/shared';
import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Avatar, Btn, Sheet, ToggleRow } from '../components/ui';
import { C, s } from '../theme';
import { useApp, zz } from '../zz';

export function SessionSettingsSheet({ sessionId, visible, onClose }: { sessionId: string; visible: boolean; onClose: () => void }) {
  const { view, me } = useApp((st) => ({ view: st.sessions[sessionId], me: st.me! }));
  const [bans, setBans] = useState<BanDTO[]>([]);
  const [modId, setModId] = useState('');
  const [banId, setBanId] = useState('');
  const load = async () => {
    const b = await zz.attempt(() => zz.api.sessionBans(sessionId));
    if (b) setBans(b);
  };
  useEffect(() => {
    if (visible) load();
  }, [visible]);
  if (!view) return null;
  const sess = view.session;
  const isOwner = view.myRole === 'OWNER';
  const update = (input: Parameters<typeof zz.api.updateSession>[1]) => zz.attempt(() => zz.api.updateSession(sessionId, input));

  return (
    <Sheet visible={visible} title="Session settings" onClose={onClose}>
      <View style={s.card}>
        <ToggleRow
          title="Set session"
          desc={isOwner ? (me.isGuest ? 'Create an account first.' : 'Keep this session after everyone leaves.') : 'Owner only.'}
          value={sess.isSet}
          disabled={!isOwner || (me.isGuest && !sess.isSet)}
          onChange={(v) => update({ isSet: v })}
        />
        <ToggleRow title="Members can create text channels" value={sess.membersCanCreateText} onChange={(v) => update({ membersCanCreateText: v })} />
        <ToggleRow title="Members can create voice channels" value={sess.membersCanCreateVoice} onChange={(v) => update({ membersCanCreateVoice: v })} />
        <ToggleRow title="Accounts only" desc="Block guests from joining." value={sess.accountsOnly} onChange={(v) => update({ accountsOnly: v })} />
      </View>
      {isOwner && (
        <>
          <Text style={s.label}>Add moderator by ID</Text>
          <View style={[s.row, { gap: 8 }]}>
            <TextInput style={[s.input, s.flex, { fontFamily: 'Menlo' }]} value={modId} onChangeText={setModId} placeholder="ZZ-XXXXXX" placeholderTextColor={C.faint} autoCapitalize="characters" />
            <Btn title="Add" disabled={modId.trim().length < 4} onPress={() => zz.attempt(() => zz.api.addMod(sessionId, modId)).then((r) => r !== undefined && (setModId(''), zz.notify('Moderator added', 'success')))} />
          </View>
          <Btn variant="secondary" title="New invite code" onPress={() => zz.attempt(() => zz.api.rotateCode(sessionId))} />
        </>
      )}
      {can(view.myRole, 'session.ban') && (
        <>
          <Text style={s.label}>Ban by ID</Text>
          <View style={[s.row, { gap: 8 }]}>
            <TextInput style={[s.input, s.flex, { fontFamily: 'Menlo' }]} value={banId} onChangeText={setBanId} placeholder="ZZ-XXXXXX" placeholderTextColor={C.faint} autoCapitalize="characters" />
            <Btn variant="danger" title="Ban" disabled={banId.trim().length < 4} onPress={() => zz.attempt(() => zz.api.ban(sessionId, { publicId: banId })).then((r) => {
              if (r !== undefined) (setBanId(''), load());
            })} />
          </View>
          <Text style={s.label}>Banned — {bans.length}</Text>
          {bans.map((b) => (
            <View key={b.user.id} style={[s.row, s.card, { gap: 10 }]}>
              <Avatar name={b.user.displayName} url={b.user.avatarUrl} staticUrl={b.user.avatarStaticUrl} size={30} />
              <View style={s.flex}>
                <Text style={s.text}>{b.user.displayName}</Text>
                <Text style={s.muted}>{b.user.publicId}</Text>
              </View>
              <Btn variant="secondary" title="Unban" onPress={() => zz.attempt(() => zz.api.unban(sessionId, b.user.id)).then(load)} style={{ paddingVertical: 6 }} />
            </View>
          ))}
        </>
      )}
      {isOwner && (
        <Btn
          variant="danger"
          title="Delete session"
          onPress={() =>
            Alert.alert('Delete session?', 'Removes it for everyone, with all messages and files.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => zz.attempt(() => zz.api.deleteSession(sessionId)).then(onClose) },
            ])
          }
        />
      )}
    </Sheet>
  );
}
