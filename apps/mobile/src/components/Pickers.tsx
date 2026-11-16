import { GIF_RATING_INFO, MAX_STICKERS_PER_USER, type GifDTO } from '@zirzircord/shared';
import { ApiError } from '@zirzircord/client-core';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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

/** GIF picker (GIPHY, the library Instagram uses): trending, search as you type, scroll for more. */
export function GifPanel({ sessionId, onSend }: { sessionId: string; onSend: (gif: GifDTO) => void }) {
  const rating = useApp((st) => st.sessions[sessionId]?.session.gifRating ?? 'PG13');
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<GifDTO[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useRef('');

  const load = async (term: string, offset: number) => {
    setLoading(true);
    try {
      const page = term ? await zz.api.searchGifs(sessionId, term, offset) : await zz.api.trendingGifs(sessionId, offset);
      if (query.current !== term) return;
      setGifs((g) => (offset === 0 ? page.gifs : [...g, ...page.gifs.filter((x) => !g.some((y) => y.id === x.id))]));
      setNext(page.nextOffset);
      setError(null);
    } catch (e) {
      if (query.current !== term) return;
      setError(e instanceof ApiError && e.code === 'gifs_disabled' ? 'GIFs aren’t set up on this server yet.' : e instanceof ApiError && e.status === 429 ? 'Too many searches. Wait a moment.' : e instanceof Error ? e.message : 'Could not load GIFs');
    } finally {
      if (query.current === term) setLoading(false);
    }
  };

  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(() => ((query.current = term), load(term, 0)), term ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, rating, sessionId]);

  // Two columns, each GIF in the shorter one.
  const cols: [GifDTO[], GifDTO[]] = [[], []];
  const heights = [0, 0];
  for (const g of gifs) {
    const i = heights[0] <= heights[1] ? 0 : 1;
    cols[i].push(g);
    heights[i] += g.height / g.width;
  }

  return (
    <View style={{ height: 320, backgroundColor: C.elev, borderRadius: 12, padding: 8, gap: 6 }}>
      <TextInput
        value={q}
        onChangeText={setQ}
        maxLength={100}
        placeholder="Search GIPHY"
        placeholderTextColor={C.faint}
        style={[s.input, { paddingVertical: 8 }]}
        returnKeyType="search"
        autoCorrect={false}
      />
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        onScroll={({ nativeEvent: n }) => {
          if (!loading && next && n.contentOffset.y + n.layoutMeasurement.height > n.contentSize.height - 200) load(query.current, next);
        }}
        scrollEventThrottle={200}
      >
        {error ? (
          <Text style={[s.muted, { textAlign: 'center', padding: 20 }]}>{error}</Text>
        ) : !gifs.length && !loading ? (
          <Text style={[s.muted, { textAlign: 'center', padding: 20 }]}>No GIFs found.</Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {cols.map((col, i) => (
              <View key={i} style={{ flex: 1, gap: 6 }}>
                {col.map((g) => (
                  <Pressable key={g.id} onPress={() => onSend(g)} accessibilityLabel={`Send GIF${g.title ? `: ${g.title}` : ''}`}>
                    <Image source={{ uri: g.previewUrl }} style={{ width: '100%', aspectRatio: g.width / g.height, borderRadius: 6, backgroundColor: C.field }} contentFit="cover" />
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        )}
        {loading && <ActivityIndicator color={C.brand} style={{ padding: 10 }} />}
      </ScrollView>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Text style={{ color: C.faint, fontSize: 11, fontWeight: '700' }}>Powered by GIPHY</Text>
        <Text style={{ color: C.faint, fontSize: 11 }}>Rating: {GIF_RATING_INFO[rating].label}</Text>
      </View>
    </View>
  );
}
