import { Image } from 'expo-image';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn } from '../components/ui';
import { C, s } from '../theme';
import { initClient, useApp, zz } from '../zz';

type Tab = 'guest' | 'login' | 'register';

export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('guest');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(zz.api.baseUrl);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { adding, current } = useApp((st) => ({ adding: st.addingAccount && !!st.me, current: st.me?.displayName }));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (server.replace(/\/$/, '') !== zz.api.baseUrl) await initClient(server.trim());
      if (tab === 'guest') await zz.guest(name.trim());
      else if (tab === 'login') await zz.login(email.trim(), password);
      else await zz.register(name.trim(), email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.rail }} behavior="padding">
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: insets.top + 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: C.main, borderRadius: 18, padding: 22, gap: 14 }}>
          {adding && (
            <Pressable onPress={() => zz.cancelAddAccount()}>
              <Text style={{ color: C.muted }}>‹ Back to {current}</Text>
            </Pressable>
          )}
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Image source={require('../../assets/icon.png')} style={{ width: 64, height: 64, borderRadius: 16 }} />
            <Text style={s.h1}>ZirZirCord</Text>
            <Text style={[s.muted, { textAlign: 'center' }]}>Private sessions with a code. Talk, share your screen, send anything.</Text>
          </View>
          <View style={{ flexDirection: 'row', backgroundColor: C.rail, borderRadius: 10, padding: 4 }}>
            {(['guest', 'login', 'register'] as Tab[]).map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 8, borderRadius: 7, backgroundColor: tab === t ? C.field : 'transparent' }}>
                <Text style={{ textAlign: 'center', color: tab === t ? C.fg : C.muted, fontWeight: '600' }}>{t === 'guest' ? 'Guest' : t === 'login' ? 'Sign in' : 'Register'}</Text>
              </Pressable>
            ))}
          </View>
          {tab !== 'login' && <TextInput style={s.input} placeholder="Display name" placeholderTextColor={C.faint} value={name} onChangeText={setName} maxLength={32} />}
          {tab !== 'guest' && (
            <>
              <TextInput style={s.input} placeholder="Email (never shown to anyone)" placeholderTextColor={C.faint} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              <TextInput style={s.input} placeholder="Password" placeholderTextColor={C.faint} value={password} onChangeText={setPassword} secureTextEntry />
            </>
          )}
          {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
          <Btn title={tab === 'guest' ? 'Continue as guest' : tab === 'login' ? 'Sign in' : 'Create account'} onPress={submit} busy={busy} disabled={tab !== 'login' && !name.trim()} />
          <Pressable onPress={() => setShowServer((v) => !v)}>
            <Text style={[s.muted, { textAlign: 'center' }]}>Server: {zz.api.baseUrl} {showServer ? '▲' : '▼'}</Text>
          </Pressable>
          {showServer && <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} placeholder="https://your-server" placeholderTextColor={C.faint} />}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
