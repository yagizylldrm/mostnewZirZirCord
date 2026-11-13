import { can, type BanDTO, SET_SESSION_EXPIRY_NOTE } from '@zirzircord/shared';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Avatar, Btn, SessionPicture, Sheet, ToggleRow } from '../components/ui';
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

  const pickIcon = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: true, aspect: [1, 1] });
    if (r.canceled) return;
    const a = r.assets[0];
    const blob = await (await fetch(a.uri)).blob();
    const mime = a.mimeType && /png|jpeg|webp|gif/.test(a.mimeType) ? a.mimeType : 'image/jpeg';
    if (await zz.attempt(() => zz.setSessionIcon(sessionId, blob, mime))) zz.notify('Session picture updated', 'success');
  };

  return (
    <Sheet visible={visible} title="Session settings" onClose={onClose}>
      {sess.isSet && can(view.myRole, 'session.editSettings') && (
        <View style={[s.card, s.row, { gap: 12 }]}>
          <SessionPicture session={sess} size={56} />
          <View style={s.flex}>
            <Text style={[s.text, { fontWeight: '700' }]}>Session picture</Text>
            <Text style={s.muted}>Shown in everyone's session list.</Text>
          </View>
          <View style={{ gap: 6 }}>
            <Btn variant="secondary" title={sess.iconUrl ? 'Change' : 'Upload'} onPress={pickIcon} />
            {sess.iconUrl && <Btn variant="secondary" title="Remove" onPress={() => zz.attempt(() => zz.setSessionIcon(sessionId, null))} />}
          </View>
        </View>
      )}
      <View style={s.card}>
        <ToggleRow
          title="Set session"
          desc={isOwner ? (me.isGuest ? 'Create an account first.' : `Keep this session after everyone leaves. ${SET_SESSION_EXPIRY_NOTE}`) : 'Owner only.'}
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
