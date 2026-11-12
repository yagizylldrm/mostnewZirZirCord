import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Toasts } from './src/components/ui';
import { AuthScreen } from './src/screens/AuthScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { C } from './src/theme';
import { initClient, useApp, zz } from './src/zz';

function Root() {
  const { ready, me, adding, active } = useApp((s) => ({
    ready: s.ready,
    me: s.me,
    adding: s.addingAccount,
    active: s.activeSessionId && s.sessions[s.activeSessionId] ? s.activeSessionId : null,
  }));

  // zirzircord://join/ABCD-EFGH links
  useEffect(() => {
    if (!me) return;
    const handle = (url: string | null) => {
      const m = url && /join\/([\w-]+)/i.exec(url);
      if (m) zz.attempt(() => zz.joinByCode(m[1]));
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, [!!me]);

  if (!ready) return <Loading />;
  if (!me || adding) return <AuthScreen />;
  return active ? <SessionScreen key={active} sessionId={active} /> : <HomeScreen />;
}

function Loading() {
  return (
    <View style={{ flex: 1, backgroundColor: C.rail, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.brand} size="large" />
    </View>
  );
}

export default function App() {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    initClient().finally(() => setBooted(true));
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: C.main }}>
        {booted ? (
          <>
            <Root />
            <Toasts />
          </>
        ) : (
          <Loading />
        )}
      </View>
    </SafeAreaProvider>
  );
}
