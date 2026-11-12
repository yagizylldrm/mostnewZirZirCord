import { STATUSES, type UserStatus } from '@zirzircord/shared';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ActivityIndicator, Alert } from 'react-native';
import { ApiError } from '@zirzircord/client-core';
import { Avatar, Banner, Btn, Sheet, ToggleRow } from '../components/ui';
import { C, s } from '../theme';
import { SOUND_GROUPS, type SoundGroup } from '@zirzircord/client-core';
import { useStore } from 'zustand';
import { sounds } from '../sounds';
import { call, useApp, useCall, zz } from '../zz';

const BANNERS = ['#5865f2', '#ff7a2f', '#23a55a', '#f23f43', '#eb459e', '#00a8fc', '#f0b232', '#2b2d31'];

export function UserSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { me, accounts } = useApp((st) => ({ me: st.me!, accounts: st.accounts }));
  const ptt = useCall((c) => c.pttMode);
  const [name, setName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [color, setColor] = useState(me.bannerColor);
  const [status, setStatus] = useState<UserStatus>(me.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  /** Pick a photo or GIF. GIFs are uploaded as-is (no cropping) so they stay animated. */
  const pickImage = async (kind: 'avatar' | 'banner') => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (r.canceled) return;
    const a = r.assets[0];
    const blob = await (await fetch(a.uri)).blob();
    const mime = a.mimeType && /png|jpeg|webp|gif/.test(a.mimeType) ? a.mimeType : 'image/jpeg';
    const ok = await zz.attempt(() => (kind === 'avatar' ? zz.uploadAvatar(blob, mime) : zz.uploadBanner(blob, mime)));
    if (ok) zz.notify(kind === 'avatar' ? 'Avatar updated' : 'Banner updated', 'success');
  };
  const pickAvatar = () => pickImage('avatar');

  return (
    <Sheet visible={visible} title="Settings" onClose={onClose}>
      <Pressable onPress={() => pickImage('banner')}>
        <Banner user={{ bannerUrl: me.bannerUrl, bannerColor: color }} height={90} />
      </Pressable>
      <View style={[s.row, { gap: 12, marginTop: -34, paddingHorizontal: 10 }]}>
        <Pressable onPress={pickAvatar}>
          <Avatar name={name || me.displayName} url={me.avatarUrl} staticUrl={me.avatarStaticUrl} size={72} animate />
        </Pressable>
        <View style={{ marginTop: 34 }}>
          <Text style={s.h2}>{me.displayName}</Text>
          <Text style={[s.muted, { fontFamily: 'Menlo' }]}>{me.publicId}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn variant="secondary" title="Change avatar" onPress={pickAvatar} style={{ flex: 1 }} />
        <Btn variant="secondary" title={me.bannerUrl ? 'Change banner' : 'Add banner'} onPress={() => pickImage('banner')} style={{ flex: 1 }} />
      </View>
      {me.bannerUrl && <Btn variant="ghost" title="Remove banner" onPress={() => zz.attempt(() => zz.updateProfile({ bannerUploadId: null }))} />}
      <Text style={s.muted}>Photos or GIFs. Animated avatars move while you talk in voice.</Text>
      <Text style={s.label}>Display name</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} maxLength={32} />
      <Text style={s.label}>About me</Text>
      <TextInput style={[s.input, { minHeight: 70 }]} value={bio} onChangeText={setBio} maxLength={300} multiline />
      <Text style={s.label}>Banner color</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {BANNERS.map((b) => (
          <Pressable key={b} onPress={() => setColor(b)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: b, borderWidth: 3, borderColor: color === b ? C.fg : 'transparent' }} />
        ))}
      </View>
      <Text style={s.label}>Status</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {STATUSES.map((st) => (
          <Pressable key={st} onPress={() => setStatus(st)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: status === st ? C.brand : C.field }}>
            <Text style={{ color: 'white' }}>{{ ONLINE: 'Online', IDLE: 'Idle', DND: 'Do not disturb', INVISIBLE: 'Invisible' }[st]}</Text>
          </Pressable>
        ))}
      </View>
      <Btn
        title="Save profile"
        onPress={async () => {
          const u = await zz.attempt(() => zz.updateProfile({ displayName: name.trim(), bio, bannerColor: color, status }));
          if (u) zz.notify('Profile saved', 'success');
        }}
      />

      <Text style={[s.label, { marginTop: 10 }]}>Voice</Text>
      <View style={s.card}>
        <ToggleRow title="Push to talk" desc="Shows a hold-to-talk button in calls." value={ptt} onChange={(v) => call.setPttMode(v)} />
      </View>

      <Text style={[s.label, { marginTop: 10 }]}>Sounds</Text>
      <SoundSettings />

      <Text style={[s.label, { marginTop: 10 }]}>Account</Text>
      {me.isGuest ? (
        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.muted}>You are a guest on this device. Create an account to keep your ID and own set sessions.</Text>
          <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.faint} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <TextInput style={s.input} placeholder="Password (8+ characters)" placeholderTextColor={C.faint} value={password} onChangeText={setPassword} secureTextEntry />
          <Btn title="Create account" onPress={() => zz.attempt(() => zz.upgrade(email.trim(), password)).then((r) => r !== undefined && zz.notify('Account created', 'success'))} />
        </View>
      ) : (
        <Text style={[s.card, s.text]}>{me.email}</Text>
      )}
      <Text style={[s.label, { marginTop: 10 }]}>Switch account</Text>
      {accounts
        .filter((a) => a.id !== me.id)
        .map((a) => (
          <Pressable key={a.id} onPress={() => (onClose(), zz.attempt(() => zz.switchAccount(a.id)))} style={[s.card, s.row, { gap: 10 }]}>
            <Avatar name={a.displayName} url={a.avatarUrl} staticUrl={a.avatarStaticUrl} size={32} />
            <View style={s.flex}>
              <Text style={s.text}>{a.displayName}</Text>
              <Text style={[s.muted, { fontFamily: 'Menlo' }]}>{a.publicId}</Text>
            </View>
            <Text style={{ color: C.brand, fontWeight: '700' }}>Switch</Text>
          </Pressable>
        ))}
      <Btn variant="secondary" title="＋ Add an account" onPress={() => (onClose(), zz.beginAddAccount())} />
      <Btn
        variant="danger"
        title={`Log out of ${me.displayName}`}
        onPress={() =>
          Alert.alert(
            `Log out of ${me.displayName}?`,
            me.isGuest
              ? 'This is a guest account: logging out permanently deletes it, with its ID, roles and stickers. Your messages stay as "Deleted user". Create an account above to keep it.'
              : 'You can sign back in any time.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: me.isGuest ? 'Log out & delete' : 'Log out', style: 'destructive', onPress: () => (onClose(), zz.logout()) },
            ],
          )
        }
      />
      <DeleteAccount onDone={onClose} />
    </Sheet>
  );
}

/** Danger zone: permanently delete this account (registered accounts confirm with their password). */
function DeleteAccount({ onDone }: { onDone: () => void }) {
  const me = useApp((st) => st.me!);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await zz.deleteAccount(me.isGuest ? undefined : password);
      onDone();
      zz.notify('Your account was deleted', 'success');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
      setBusy(false);
    }
  };
  const confirm = () =>
    Alert.alert('Delete account forever?', `${me.displayName} (${me.publicId}) will be deleted. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);

  if (!open) return <Btn variant="secondary" title="Delete account…" onPress={() => setOpen(true)} />;
  return (
    <View style={[s.card, { gap: 8, borderWidth: 1, borderColor: C.danger }]}>
      <Text style={[s.text, { color: C.danger, fontWeight: '700' }]}>Delete account</Text>
      <Text style={s.muted}>
        Deletes your profile, avatar, banner and stickers. Messages stay as "Deleted user"; sessions you own pass to the member who joined first.
      </Text>
      {!me.isGuest && (
        <TextInput
          style={s.input}
          placeholder="Your password"
          placeholderTextColor={C.faint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
      )}
      {error && <Text style={{ color: C.danger }}>{error}</Text>}
      {busy ? (
        <ActivityIndicator color={C.danger} />
      ) : (
        <View style={[s.row, { gap: 8 }]}>
          <View style={s.flex}>
            <Btn variant="secondary" title="Cancel" onPress={() => (setOpen(false), setPassword(''), setError(null))} />
          </View>
          <View style={s.flex}>
            <Btn variant="danger" title="Delete forever" onPress={confirm} disabled={!me.isGuest && !password} />
          </View>
        </View>
      )}
    </View>
  );
}

const VOLUMES = [0.25, 0.5, 0.75, 1];

function SoundSettings() {
  const prefs = useStore(sounds.store);
  return (
    <View style={s.card}>
      <ToggleRow title="Sound effects" desc="Join/leave chimes, message sounds and pings" value={prefs.enabled} onChange={(v) => sounds.update({ enabled: v })} />
      <View style={[s.row, { gap: 6, paddingVertical: 6, opacity: prefs.enabled ? 1 : 0.4 }]}>
        <Text style={[s.muted, { marginRight: 4 }]}>Volume</Text>
        {VOLUMES.map((v) => (
          <Pressable
            key={v}
            disabled={!prefs.enabled}
            onPress={() => (sounds.update({ volume: v }), sounds.preview('message'))}
            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: Math.abs(prefs.volume - v) < 0.13 ? C.brand : C.field }}
          >
            <Text style={{ color: 'white' }}>{Math.round(v * 100)}%</Text>
          </Pressable>
        ))}
      </View>
      {(Object.keys(SOUND_GROUPS) as SoundGroup[]).map((g) => (
        <View key={g} style={[s.row, { gap: 8, opacity: prefs.enabled ? 1 : 0.4 }]}>
          <Pressable onPress={() => sounds.preview(SOUND_GROUPS[g].preview)} hitSlop={8} style={{ paddingRight: 4 }}>
            <Text style={{ color: C.muted }}>▶</Text>
          </Pressable>
          <View style={s.flex}>
            <ToggleRow title={SOUND_GROUPS[g].label} value={prefs.groups[g]} onChange={(v) => sounds.update({ groups: { [g]: v } })} disabled={!prefs.enabled} />
          </View>
        </View>
      ))}
    </View>
  );
}
