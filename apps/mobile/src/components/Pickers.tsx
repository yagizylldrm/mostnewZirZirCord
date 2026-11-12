import { MAX_STICKERS_PER_USER } from '@zirzircord/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { EMOJI_CATEGORIES } from '../emoji';
import { C, s } from '../theme';
import { useApp, zz } from '../zz';

/** Emoji grid shown under the composer. */
export function EmojiPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const [cat, setCat] = useState(0);
  return (
    <View style={{ height: 260, backgroundColor: C.elev, borderRadius: 12 }}>
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 6, gap: 4 }} showsHorizontalScrollIndicator={false}>
        {EMOJI_CATEGORIES.map((c, i) => (
          <Pressable key={c.name} onPress={() => setCat(i)} style={{ padding: 6, borderRadius: 8, backgroundColor: i === cat ? C.field : 'transparent' }}>
            <Text style={{ fontSize: 20 }}>{c.icon}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6, paddingBottom: 10 }}>
        {EMOJI_CATEGORIES[cat].emojis.map((e, i) => (
          <Pressable key={i} onPress={() => onPick(e)} style={{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 26 }}>{e}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** WhatsApp-style sticker drawer: tap to send, ＋ to make one from a photo/GIF, long-press to delete. */
export function StickerPanel({ onSend }: { onSend: (stickerId: string) => void }) {
  const stickers = useApp((st) => st.stickers);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    zz.loadStickers().catch((e) => zz.notify(e.message, 'error'));
  }, []);

  const create = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
    if (r.canceled) return;
    const a = r.assets[0];
    const mime = a.mimeType && /png|jpeg|webp|gif/.test(a.mimeType) ? a.mimeType : 'image/jpeg';
    setBusy(true);
    const blob = await (await fetch(a.uri)).blob();
    if (await zz.attempt(() => zz.createSticker(blob, mime))) zz.notify('Sticker created', 'success');
    setBusy(false);
  };

  return (
    <View style={{ height: 260, backgroundColor: C.elev, borderRadius: 12, padding: 8 }}>
      <Text style={[s.label, { marginBottom: 6 }]}>
        Your stickers {stickers ? `· ${stickers.length}/${MAX_STICKERS_PER_USER}` : ''}
      </Text>
      <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pressable onPress={create} disabled={busy} style={{ width: 72, height: 72, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <ActivityIndicator color={C.brand} /> : <Text style={{ color: C.muted, fontSize: 28 }}>＋</Text>}
        </Pressable>
        {stickers?.map((st) => (
          <Pressable
            key={st.id}
            onPress={() => onSend(st.id)}
            onLongPress={() =>
              Alert.alert('Delete sticker?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => zz.attempt(() => zz.deleteSticker(st.id)) },
              ])
            }
            style={{ width: 72, height: 72 }}
          >
            <Image source={{ uri: st.url }} style={{ width: 72, height: 72 }} contentFit="contain" />
          </Pressable>
        ))}
      </ScrollView>
      {stickers?.length === 0 && <Text style={[s.muted, { marginTop: 6 }]}>Make stickers from any photo or GIF, or save ones people send you.</Text>}
    </View>
  );
}
