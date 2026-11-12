import type { AttachmentDTO } from '@zirzircord/shared';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Alert, Pressable, Text, View } from 'react-native';
import { zz } from '../zz';
import { C, formatBytes, formatDuration, s } from '../theme';

export function AttachmentView({ a }: { a: AttachmentDTO }) {
  if (a.kind === 'IMAGE') {
    const w = a.width ?? 400;
    const h = a.height ?? 300;
    const width = Math.min(260, w);
    return (
      <Pressable onPress={() => Linking.openURL(a.url)}>
        <Image source={{ uri: a.thumbnailUrl ?? a.url }} style={{ width, height: (width * h) / w, borderRadius: 10, backgroundColor: C.rail }} contentFit="cover" />
      </Pressable>
    );
  }
  if (a.kind === 'VOICE_MESSAGE') return <VoiceMessage a={a} />;
  if (a.kind === 'STICKER') {
    return (
      <Pressable
        onLongPress={() =>
          Alert.alert('Sticker', undefined, [
            { text: 'Save sticker', onPress: () => zz.attempt(() => zz.saveSticker(a.id)).then((r) => r && zz.notify('Sticker saved', 'success')) },
            { text: 'Cancel', style: 'cancel' },
          ])
        }
      >
        <Image source={{ uri: a.url }} style={{ width: 150, height: 150 }} contentFit="contain" />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => Linking.openURL(a.url)} style={[s.row, { backgroundColor: C.side, borderRadius: 10, padding: 10, gap: 10, maxWidth: 280 }]}>
      <Text style={{ fontSize: 28 }}>{a.kind === 'VIDEO' ? '🎬' : a.kind === 'AUDIO' ? '🎵' : '📄'}</Text>
      <View style={s.flex}>
        <Text style={{ color: C.brand, fontWeight: '600' }} numberOfLines={1}>
          {a.filename}
        </Text>
        <Text style={s.muted}>
          {formatBytes(a.size)}
          {a.durationMs ? ` · ${formatDuration(a.durationMs)}` : ''} · tap to open
        </Text>
      </View>
    </Pressable>
  );
}

function VoiceMessage({ a }: { a: AttachmentDTO }) {
  const player = useAudioPlayer({ uri: a.url });
  const st = useAudioPlayerStatus(player);
  const duration = (st.duration || (a.durationMs ?? 0) / 1000) * 1000;
  const progress = st.duration ? st.currentTime / st.duration : 0;
  const bars = a.waveform?.length ? a.waveform : new Array(40).fill(80);
  const toggle = () => {
    if (st.playing) player.pause();
    else {
      if (st.didJustFinish || (st.duration && st.currentTime >= st.duration - 0.05)) player.seekTo(0);
      player.play();
    }
  };
  return (
    <View style={[s.row, { backgroundColor: C.side, borderRadius: 24, paddingVertical: 6, paddingLeft: 6, paddingRight: 12, gap: 10, width: 260 }]}>
      <Pressable onPress={toggle} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: 'white', fontSize: 13 }}>{st.playing ? '❚❚' : '▶'}</Text>
      </Pressable>
      <View style={[s.row, { flex: 1, height: 28, gap: 1.5 }]}>
        {bars.map((v, i) => (
          <View key={i} style={{ flex: 1, borderRadius: 2, height: `${Math.max(14, (v / 255) * 100)}%`, backgroundColor: i / bars.length < progress ? C.brand : C.faint }} />
        ))}
      </View>
      <Text style={[s.muted, { fontFamily: 'Menlo', fontSize: 11 }]}>{formatDuration(st.playing ? st.currentTime * 1000 : duration)}</Text>
    </View>
  );
}
