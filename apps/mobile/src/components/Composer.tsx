import { type FormatSpan, LIMITS, canMentionEveryone, formatSpans, mentionToken } from '@zirzircord/shared';
import { listedMembers, memberName, type OutgoingFile } from '@zirzircord/client-core';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { C, formatDuration, s } from '../theme';
import { EmojiPanel, StickerPanel } from './Pickers';
import { Avatar } from './ui';
import { call, useApp, zz } from '../zz';

async function uriToBlob(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** How a run of typed text looks in the message box (the sent message is drawn by FormattedText). */
function spanStyle(sp: FormatSpan) {
  const lines = [sp.underline && 'underline', sp.strike && 'line-through'].filter(Boolean).join(' ');
  return {
    color: sp.marker ? C.faint : sp.link ? '#38bdf8' : sp.quote ? C.muted : C.fg,
    ...(sp.bold && { fontWeight: '700' as const }),
    ...(sp.italic && { fontStyle: 'italic' as const }),
    ...(lines && { textDecorationLine: lines as 'underline' | 'line-through' | 'underline line-through' }),
    ...(sp.code && { fontFamily: MONO, backgroundColor: C.rail }),
    ...(sp.spoiler && { backgroundColor: C.line }),
  };
}

export function Composer({ sessionId, channelId, channelName }: { sessionId: string; channelId: string; channelName: string }) {
  const [text, setText] = useState('');
  // The typed text, styled as you type (markers stay visible but dimmed). The runs join back to exactly `text`.
  const spans = useMemo(() => formatSpans(text), [text]);
  const [busy, setBusy] = useState(false);
  const uploads = useApp((st) => st.uploads);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recState = useAudioRecorderState(recorder, 100);
  const levels = useRef<number[]>([]);
  const [recording, setRecording] = useState(false);
  const [panel, setPanel] = useState<'emoji' | 'stickers' | null>(null);
  const { view, meId } = useApp((st) => ({ view: st.sessions[sessionId], meId: st.me!.id }));
  // @mention autocomplete ("@Name" → <@id> on send)
  const mentionMap = useRef(new Map<string, string>());
  const query = /(^|\s)@([^\s@]{0,32})$/.exec(text)?.[2];
  const suggestions = useMemo(() => {
    if (query === undefined || !view) return [];
    const q = query.toLowerCase();
    const people = listedMembers(view)
      .filter((m) => m.user.id !== meId)
      .map((m) => ({ id: m.user.id, name: memberName(view, m.user.id), user: m.user as typeof m.user | null }))
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 6);
    const all = canMentionEveryone(view.myRole, view.session) && 'everyone'.startsWith(q) ? [{ id: 'everyone', name: 'everyone', user: null }] : [];
    return [...all, ...people];
  }, [query, view, meId]);
  const pickMention = (name: string, id: string) => {
    if (id !== 'everyone') mentionMap.current.set(name, id);
    setText(text.replace(/@([^\s@]{0,32})$/, `@${name} `));
  };
  const toTokens = (value: string) => {
    let out = value;
    for (const [name, id] of [...mentionMap.current].sort((a, b) => b[0].length - a[0].length)) out = out.split(`@${name}`).join(mentionToken(id));
    return out;
  };

  useEffect(() => {
    if (recording && typeof recState.metering === 'number') {
      // metering is dBFS (-160..0) → 0..1
      levels.current.push(Math.max(0, Math.min(1, (recState.metering + 55) / 55)));
    }
    if (recording && recState.durationMillis > LIMITS.voiceMessageMaxSeconds * 1000) stopRecording(true);
  }, [recState.durationMillis]);

  const send = async (files: OutgoingFile[] = []) => {
    const raw = text.trim();
    const content = toTokens(raw);
    if (!content && !files.length) return;
    setBusy(true);
    setText('');
    // Shows instantly; if it fails, the message gets Retry / Delete in the chat.
    await zz.sendMessage(sessionId, channelId, content, files);
    setBusy(false);
  };

  const pickMedia = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 0.9, selectionLimit: LIMITS.attachmentsPerMessage });
    if (r.canceled) return;
    const files = await Promise.all(
      r.assets.map(async (a): Promise<OutgoingFile> => ({
        blob: await uriToBlob(a.uri),
        filename: a.fileName ?? `media-${Date.now()}.${a.type === 'video' ? 'mp4' : 'jpg'}`,
        mime: a.mimeType ?? (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
        kind: a.type === 'video' ? 'VIDEO' : 'IMAGE',
        width: a.width,
        height: a.height,
        durationMs: a.duration ?? undefined,
      })),
    );
    await send(files);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return zz.notify('Camera permission denied', 'error');
    const r = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (r.canceled) return;
    const a = r.assets[0];
    await send([{ blob: await uriToBlob(a.uri), filename: a.fileName ?? `photo-${Date.now()}.jpg`, mime: a.mimeType ?? 'image/jpeg', kind: 'IMAGE', width: a.width, height: a.height }]);
  };

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    const files = await Promise.all(
      r.assets.map(async (a): Promise<OutgoingFile> => {
        const mime = a.mimeType ?? 'application/octet-stream';
        return { blob: await uriToBlob(a.uri), filename: a.name, mime, kind: mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('video/') ? 'VIDEO' : mime.startsWith('audio/') ? 'AUDIO' : 'FILE' };
      }),
    );
    await send(files);
  };

  const attach = () => {
    const options = ['Photo or video', 'Take photo', 'File', 'Cancel'];
    const actions = [pickMedia, takePhoto, pickFile];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 3 }, (i) => actions[i]?.());
    } else {
      Alert.alert('Send', undefined, [...options.slice(0, 3).map((t, i) => ({ text: t, onPress: () => actions[i]() })), { text: 'Cancel', style: 'cancel' }]);
    }
  };

  const startRecording = async () => {
    if (call.state.status !== 'idle') return zz.notify('Leave the voice channel to record a voice message', 'error');
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return zz.notify('Microphone permission denied', 'error');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    levels.current = [];
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };

  async function stopRecording(sendIt: boolean) {
    setRecording(false);
    const durationMs = recorder.currentTime * 1000;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!sendIt || !recorder.uri || durationMs < 500) return;
    const lv = levels.current;
    const n = 64;
    const waveform = Array.from({ length: n }, (_, i) => {
      const slice = lv.slice(Math.floor((i * lv.length) / n), Math.max(Math.floor(((i + 1) * lv.length) / n), Math.floor((i * lv.length) / n) + 1));
      return Math.round(Math.max(0, ...slice) * 255);
    });
    await send([{ blob: await uriToBlob(recorder.uri), filename: `voice-message-${Date.now()}.m4a`, mime: 'audio/mp4', kind: 'VOICE_MESSAGE', durationMs: Math.round(durationMs), waveform }]);
  }

  const myUploads = uploads.filter((u) => u.channelId === channelId);
  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 6, gap: 6 }}>
      {suggestions.length > 0 && (
        <View style={{ backgroundColor: C.elev, borderRadius: 10, paddingVertical: 4 }}>
          {suggestions.map((m) => (
            <Pressable key={m.id} onPress={() => pickMention(m.name, m.id)} style={[s.row, { paddingHorizontal: 12, paddingVertical: 8, gap: 10 }]}>
              {m.user ? (
                <Avatar name={m.name} url={m.user.avatarUrl} staticUrl={m.user.avatarStaticUrl} size={24} />
              ) : (
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: 'white' }}>@</Text>
                </View>
              )}
              <Text style={s.text}>{m.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {myUploads.map((u) => (
        <View key={u.id} style={{ backgroundColor: C.side, borderRadius: 8, padding: 8 }}>
          <Text style={s.muted}>
            Uploading {u.filename} · {Math.round(u.progress * 100)}%
          </Text>
          <View style={{ height: 3, backgroundColor: C.line, borderRadius: 2, marginTop: 4 }}>
            <View style={{ height: 3, width: `${u.progress * 100}%`, backgroundColor: C.brand, borderRadius: 2 }} />
          </View>
        </View>
      ))}
      {recording ? (
        <View style={[s.row, { backgroundColor: C.field, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, gap: 10 }]}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.danger }} />
          <Text style={[s.text, { fontFamily: 'Menlo' }]}>{formatDuration(recState.durationMillis)}</Text>
          <View style={s.flex} />
          <Pressable onPress={() => stopRecording(false)} hitSlop={8}>
            <Text style={{ color: C.muted, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => stopRecording(true)} style={{ backgroundColor: C.brand, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 }}>
            <Text style={{ color: 'white', fontWeight: '700' }}>Send</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[s.row, { backgroundColor: C.field, borderRadius: 22, paddingLeft: 6, paddingRight: 6, gap: 4 }]}>
          <Pressable onPress={attach} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: C.fg, fontSize: 20, lineHeight: 22 }}>＋</Text>
          </Pressable>
          <TextInput
            style={{ flex: 1, color: C.fg, fontSize: 15, paddingVertical: 10, paddingHorizontal: 6, maxHeight: 120 }}
            placeholder={`Message #${channelName}`}
            placeholderTextColor={C.faint}
            onChangeText={(t) => (setText(t), zz.sendTyping(channelId))}
            onFocus={() => setPanel(null)}
            multiline
            maxLength={LIMITS.message}
          >
            {spans.map((sp, i) => (
              <Text key={i} style={spanStyle(sp)}>
                {sp.text}
              </Text>
            ))}
          </TextInput>
          <Pressable onPress={() => setPanel(panel === 'stickers' ? null : 'stickers')} hitSlop={6} accessibilityLabel="Stickers" style={{ padding: 4 }}>
            <Text style={{ fontSize: 19, opacity: panel === 'stickers' ? 1 : 0.7 }}>🏷️</Text>
          </Pressable>
          <Pressable onPress={() => setPanel(panel === 'emoji' ? null : 'emoji')} hitSlop={6} accessibilityLabel="Emoji" style={{ padding: 4 }}>
            <Text style={{ fontSize: 19, opacity: panel === 'emoji' ? 1 : 0.7 }}>😊</Text>
          </Pressable>
          {text.trim() ? (
            <Pressable onPress={() => send()} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: 'white', fontSize: 15 }}>➤</Text>
            </Pressable>
          ) : (
            <Pressable onPress={startRecording} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Record voice message">
              <Text style={{ fontSize: 20 }}>🎙️</Text>
            </Pressable>
          )}
        </View>
      )}
      {panel === 'emoji' && <EmojiPanel onPick={(e) => setText((t) => t + e)} />}
      {panel === 'stickers' && (
        <StickerPanel onSend={(id) => (setPanel(null), zz.attempt(() => zz.sendSticker(sessionId, channelId, id)))} />
      )}
    </View>
  );
}
