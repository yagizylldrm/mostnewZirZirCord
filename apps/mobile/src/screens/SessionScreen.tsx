import { AudioSession, VideoView } from '@livekit/react-native';
import { isChannelMuted, isSessionMuted, memberName, sessionUnread } from '@zirzircord/client-core';
import { can, canCreateChannel, canModerate, formatSessionCode, isJumboEmoji, splitMentions, type MessageDTO } from '@zirzircord/shared';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachmentView } from '../components/Attachments';
import { Composer } from '../components/Composer';
import { Avatar, Banner, Btn, RoleBadge, RoundBtn, Sheet } from '../components/ui';
import { C, s } from '../theme';
import { call, useApp, useCall, zz } from '../zz';
import { NotificationSheet } from './NotificationSheet';
import { SessionSettingsSheet } from './SessionSettingsSheet';

type Tab = 'chat' | 'voice' | 'members';

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const insets = useSafeAreaInsets();
  const view = useApp((st) => st.sessions[sessionId]);
  const [tab, setTab] = useState<Tab>('chat');
  const [settings, setSettings] = useState(false);
  const [notifs, setNotifs] = useState(false);
  const chatUnread = useApp((st) => {
    if (isSessionMuted(st, sessionId)) return 0;
    return (st.sessions[sessionId]?.channels ?? []).reduce((n, c) => n + (isChannelMuted(st, sessionId, c.id) ? 0 : (st.unread[c.id]?.mentions ?? 0)), 0);
  });
  const [menu, setMenu] = useState(false);
  const inCall = useCall((c) => c.sessionId === sessionId && c.status !== 'idle');
  if (!view) return null;
  const hostName = view.presence.hostId ? memberName(view, view.presence.hostId) : '—';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.main }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top, backgroundColor: C.side }}>
        <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 8, gap: 10 }]}>
          <Pressable onPress={() => zz.setActiveSession(null)} hitSlop={12}>
            <Text style={{ color: C.fg, fontSize: 30, lineHeight: 32 }}>‹</Text>
          </Pressable>
          <Pressable style={s.flex} onPress={() => setMenu(true)}>
            <Text style={s.h2} numberOfLines={1}>
              {view.session.name} ▾
            </Text>
            <Text style={s.muted} numberOfLines={1}>
              👑 Host: {hostName} · {view.presence.present.length} here
            </Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(formatSessionCode(view.session.code));
              zz.notify('Invite code copied', 'success');
            }}
            style={{ backgroundColor: C.rail, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Text style={[s.label, { fontSize: 9 }]}>CODE</Text>
            <Text style={{ color: C.fg, fontFamily: 'Menlo', fontWeight: '700' }}>{formatSessionCode(view.session.code)}</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {(['chat', 'voice', 'members'] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={{ flex: 1, paddingVertical: 10, borderBottomWidth: 2, borderColor: tab === t ? C.brand : 'transparent' }}>
              <Text style={{ textAlign: 'center', color: tab === t ? C.fg : C.muted, fontWeight: '600' }}>
                {t === 'chat' ? `# Chat${chatUnread && tab !== 'chat' ? ` (${chatUnread})` : ''}` : t === 'voice' ? `🔊 Voice${inCall ? ' ●' : ''}` : `👥 ${view.presence.present.length}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flex: 1, paddingBottom: tab === 'chat' ? insets.bottom + 6 : 0 }}>
        {tab === 'chat' && <ChatTab sessionId={sessionId} />}
        {tab === 'voice' && <VoiceTab sessionId={sessionId} />}
        {tab === 'members' && <MembersTab sessionId={sessionId} />}
      </View>

      <Sheet visible={menu} title={view.session.name} onClose={() => setMenu(false)}>
        {can(view.myRole, 'session.editSettings') && <Btn variant="secondary" title="⚙️ Session settings" onPress={() => (setMenu(false), setSettings(true))} />}
        <Btn variant="secondary" title="🔔 Notification settings" onPress={() => (setMenu(false), setNotifs(true))} />
        <NicknameEditor sessionId={sessionId} />
        <Btn
          variant="danger"
          title="Leave session"
          onPress={() => {
            setMenu(false);
            zz.leaveSession(sessionId);
          }}
        />
      </Sheet>
      <SessionSettingsSheet sessionId={sessionId} visible={settings} onClose={() => setSettings(false)} />
      <NotificationSheet sessionId={sessionId} visible={notifs} onClose={() => setNotifs(false)} />
    </KeyboardAvoidingView>
  );
}

function NicknameEditor({ sessionId }: { sessionId: string }) {
  const { nick, me } = useApp((st) => ({ nick: st.sessions[sessionId]?.members[st.me!.id]?.nickname ?? '', me: st.me! }));
  const [value, setValue] = useState(nick);
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>Nickname in this session</Text>
      <View style={[s.row, { gap: 8 }]}>
        <TextInput style={[s.input, s.flex]} value={value} onChangeText={setValue} placeholder={me.displayName} placeholderTextColor={C.faint} maxLength={32} />
        <Btn title="Save" onPress={() => zz.attempt(() => zz.api.setNickname(sessionId, value.trim() || null)).then((r) => r !== undefined && zz.notify('Saved', 'success'))} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------- chat

function ChatTab({ sessionId }: { sessionId: string }) {
  const { view, active, unread, mutedKey, sessionMuted } = useApp((st) => ({
    view: st.sessions[sessionId],
    active: st.activeChannel[sessionId],
    unread: st.unread,
    mutedKey: (st.sessions[sessionId]?.channels ?? []).filter((c) => isChannelMuted(st, sessionId, c.id)).map((c) => c.id).join(','),
    sessionMuted: isSessionMuted(st, sessionId),
  }));
  const textChannels = view?.channels.filter((c) => c.type === 'TEXT') ?? [];
  const channel = textChannels.find((c) => c.id === active) ?? textChannels[0];
  const [newChannel, setNewChannel] = useState(false);

  return (
    <View style={s.flex}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 8, gap: 6 }}>
        {textChannels.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => zz.setActiveChannel(sessionId, c.id)}
            onLongPress={() => {
              const muted = mutedKey.split(',').includes(c.id);
              zz.attempt(() => zz.setChannelMute(sessionId, c.id, muted ? 'unmute' : null)).then(() => zz.notify(muted ? `#${c.name} unmuted` : `#${c.name} muted`, 'success'));
            }}
            style={[s.row, { gap: 6, backgroundColor: c.id === channel?.id ? C.field : C.side, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, opacity: mutedKey.split(',').includes(c.id) ? 0.5 : 1 }]}
          >
            <Text style={{ color: c.id === channel?.id || (unread[c.id]?.count && !sessionMuted) ? C.fg : C.muted, fontWeight: '600' }}>
              # {c.name}
              {mutedKey.split(',').includes(c.id) ? ' 🔕' : ''}
            </Text>
            {c.id !== channel?.id && !!unread[c.id]?.mentions && !sessionMuted && !mutedKey.split(',').includes(c.id) && (
              <View style={{ backgroundColor: C.danger, borderRadius: 9, paddingHorizontal: 6, minWidth: 18, alignItems: 'center' }}>
                <Text style={{ color: 'white', fontSize: 11, fontWeight: '800' }}>{unread[c.id].mentions}</Text>
              </View>
            )}
          </Pressable>
        ))}
        {view && canCreateChannel(view.myRole, 'TEXT', view.session) && (
          <Pressable onPress={() => setNewChannel(true)} style={{ backgroundColor: C.side, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: C.ok, fontWeight: '700' }}>＋</Text>
          </Pressable>
        )}
      </ScrollView>
      {channel ? <Messages key={channel.id} sessionId={sessionId} channelId={channel.id} /> : <Text style={[s.muted, { padding: 20 }]}>No text channels.</Text>}
      {channel && <Composer sessionId={sessionId} channelId={channel.id} channelName={channel.name} />}
      <NewChannelSheet sessionId={sessionId} type="TEXT" visible={newChannel} onClose={() => setNewChannel(false)} />
    </View>
  );
}

function Messages({ sessionId, channelId }: { sessionId: string; channelId: string }) {
  const { cm, view, meId, typing } = useApp((st) => ({ cm: st.messages[channelId], view: st.sessions[sessionId], meId: st.me!.id, typing: st.typing[channelId] }));
  useEffect(() => {
    zz.loadMessages(channelId).catch((e) => zz.notify(e.message, 'error'));
  }, [channelId]);
  // Tell the client what's on screen (unread counts / notifications).
  useEffect(() => {
    zz.setViewing(channelId, RNAppState.currentState === 'active');
    const sub = RNAppState.addEventListener('change', (st) => zz.setViewing(channelId, st === 'active'));
    return () => {
      sub.remove();
      zz.setViewing(null, false);
    };
  }, [channelId]);
  const data = useMemo(() => [...(cm?.items ?? [])].reverse(), [cm?.items]);
  const typers = Object.entries(typing ?? {})
    .filter(([u, exp]) => exp > Date.now() && u !== meId)
    .map(([u]) => memberName(view, u));

  const onLongPress = (m: MessageDTO) => {
    const mine = m.authorId === meId;
    const canDel = mine || can(view?.myRole, 'message.deleteAny');
    if (!canDel) return;
    Alert.alert('Message', undefined, [
      { text: 'Delete', style: 'destructive', onPress: () => zz.attempt(() => zz.api.deleteMessage(m.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={s.flex}>
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        onEndReached={() => zz.loadOlder(channelId).catch(() => {})}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingVertical: 8 }}
        renderItem={({ item: m, index }) => {
          const prev = data[index + 1];
          const grouped = prev && prev.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          const member = m.authorId ? view?.members[m.authorId] : undefined;
          const color = !m.authorId ? C.muted : member?.role === 'OWNER' ? C.owner : member?.role === 'MOD' ? C.mod : C.fg;
          return (
            <Pressable
              onLongPress={() => !m.pending && onLongPress(m)}
              style={[
                m.pending && !m.failed && { opacity: 0.6 },
                { flexDirection: 'row', paddingHorizontal: 12, paddingTop: grouped ? 2 : 10, gap: 10 },
                (m.mentions.includes(meId) || m.mentionsEveryone) && { backgroundColor: C.brand + '14', borderLeftWidth: 2, borderLeftColor: C.brand },
              ]}
            >
              <View style={{ width: 38 }}>{!grouped && <Avatar name={memberName(view, m.authorId)} url={member?.user.avatarUrl} staticUrl={member?.user.avatarStaticUrl} size={38} />}</View>
              <View style={[s.flex, { gap: 4 }]}>
                {!grouped && (
                  <View style={[s.row, { gap: 8 }]}>
                    <Text style={{ color, fontWeight: '700' }}>{memberName(view, m.authorId)}</Text>
                    <Text style={{ color: C.faint, fontSize: 11 }}>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                )}
                {m.content ? (
                  isJumboEmoji(m.content) ? (
                    <Text style={{ fontSize: 44, lineHeight: 54 }}>{m.content}</Text>
                  ) : (
                    <Text style={[s.text, { lineHeight: 21 }]} selectable>
                      {splitMentions(m.content).map((part, i) =>
                        part.type === 'text' ? (
                          part.text
                        ) : (
                          <Text key={i} style={{ color: C.brand, fontWeight: '700', backgroundColor: C.brand + '26' }}>
                            @{part.type === 'everyone' ? 'everyone' : memberName(view, part.userId)}
                          </Text>
                        ),
                      )}
                      {m.editedAt ? <Text style={{ color: C.faint, fontSize: 10 }}> (edited)</Text> : null}
                    </Text>
                  )
                ) : null}
                {m.attachments.map((a) => (
                  <AttachmentView key={a.id} a={a} />
                ))}
                {m.localFiles?.map((f, i) => (
                  <Text key={i} style={s.muted}>
                    {f.kind === 'VOICE_MESSAGE' ? '🎙️ Voice message' : `📎 ${f.filename}`}
                  </Text>
                ))}
                {m.pending && !m.failed && <Text style={{ color: C.faint, fontSize: 11 }}>Sending…</Text>}
                {m.failed && (
                  <View style={[s.row, { gap: 12 }]}>
                    <Text style={{ color: C.danger, fontSize: 12 }}>Couldn’t send.</Text>
                    <Pressable onPress={() => zz.retrySend(m.channelId, m.nonce!)} hitSlop={8}>
                      <Text style={{ color: C.danger, fontWeight: '700', fontSize: 12 }}>Retry</Text>
                    </Pressable>
                    <Pressable onPress={() => zz.discardFailed(m.channelId, m.nonce!)} hitSlop={8}>
                      <Text style={{ color: C.muted, fontSize: 12 }}>Delete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={cm?.loaded && !cm.hasMore ? <Text style={[s.muted, { textAlign: 'center', padding: 16 }]}>This is the start of the channel.</Text> : undefined}
      />
      <Text style={[s.muted, { paddingHorizontal: 14, height: 18, fontSize: 12 }]}>{typers.length ? `${typers.slice(0, 3).join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing…` : ''}</Text>
    </View>
  );
}

function NewChannelSheet({ sessionId, type, visible, onClose }: { sessionId: string; type: 'TEXT' | 'VOICE'; visible: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <Sheet visible={visible} title={`New ${type === 'TEXT' ? 'text' : 'voice'} channel`} onClose={onClose}>
      <TextInput style={s.input} value={name} onChangeText={setName} placeholder={type === 'TEXT' ? 'new-channel' : 'Hangout'} placeholderTextColor={C.faint} maxLength={32} autoFocus />
      <Btn
        title="Create"
        disabled={!name.trim()}
        onPress={async () => {
          const c = await zz.attempt(() => zz.api.createChannel(sessionId, { name: name.trim(), type }));
          if (c) {
            if (type === 'TEXT') zz.setActiveChannel(sessionId, c.id);
            setName('');
            onClose();
          }
        }}
      />
    </Sheet>
  );
}

// ------------------------------------------------------------------ voice

function VoiceTab({ sessionId }: { sessionId: string }) {
  const view = useApp((st) => st.sessions[sessionId]);
  const c = useCall((c) => ({ status: c.status, sessionId: c.sessionId, channelId: c.channelId }));
  const [newChannel, setNewChannel] = useState(false);
  if (!view) return null;
  const inThis = c.sessionId === sessionId && c.status !== 'idle';

  const join = async (channelId: string) => {
    await AudioSession.startAudioSession();
    await call.join(sessionId, channelId);
    if (call.state.status === 'idle') await AudioSession.stopAudioSession();
  };

  return (
    <View style={s.flex}>
      {inThis ? (
        <CallStage sessionId={sessionId} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
          {view.channels
            .filter((ch) => ch.type === 'VOICE')
            .map((ch) => {
              const occ = view.voice[ch.id] ?? [];
              return (
                <View key={ch.id} style={[s.card, { gap: 8 }]}>
                  <View style={[s.row, { gap: 8 }]}>
                    <Text style={[s.text, s.flex, { fontWeight: '600' }]}>🔊 {ch.name}</Text>
                    <Btn title={c.channelId === ch.id ? 'Connected' : 'Join'} onPress={() => join(ch.id)} style={{ paddingVertical: 7 }} />
                  </View>
                  {occ.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {occ.map((uid) => (
                        <View key={uid} style={[s.row, { gap: 6 }]}>
                          <Avatar name={memberName(view, uid)} url={view.members[uid]?.user.avatarUrl} staticUrl={view.members[uid]?.user.avatarStaticUrl} size={22} />
                          <Text style={s.muted}>{memberName(view, uid)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          {canCreateChannel(view.myRole, 'VOICE', view.session) && <Btn variant="secondary" title="＋ New voice channel" onPress={() => setNewChannel(true)} />}
        </ScrollView>
      )}
      <NewChannelSheet sessionId={sessionId} type="VOICE" visible={newChannel} onClose={() => setNewChannel(false)} />
    </View>
  );
}

function CallStage({ sessionId }: { sessionId: string }) {
  const insets = useSafeAreaInsets();
  const view = useApp((st) => st.sessions[sessionId]);
  const c = useCall((c) => ({ participants: c.participants, mic: c.micEnabled, deaf: c.deafened, cam: c.cameraEnabled, screen: c.screenSharing, v: c.trackVersion, status: c.status, ptt: c.pttMode, channelId: c.channelId, micError: c.micError, serverMuted: c.serverMuted }));
  const sharer = c.participants.find((p) => p.screenSharing && !p.isLocal) ?? c.participants.find((p) => p.screenSharing);
  const channel = view?.channels.find((ch) => ch.id === c.channelId);

  const leave = async () => {
    await call.leave();
    await AudioSession.stopAudioSession();
  };

  return (
    <View style={[s.flex, { backgroundColor: C.rail }]}>
      <Text style={[s.muted, { padding: 10 }]}>
        🔊 {channel?.name} · {c.status === 'connected' ? `${c.participants.length} connected` : c.status}
      </Text>
      {c.serverMuted && (
        <View style={{ marginHorizontal: 8, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: C.danger + '26' }}>
          <Text style={{ color: C.danger }}>🔇 A moderator muted you in this session. You can still listen.</Text>
        </View>
      )}
      {c.micError && (
        <Pressable onPress={() => call.toggleMic()} style={{ marginHorizontal: 8, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: C.warn + '26' }}>
          <Text style={{ color: C.warn }}>{c.micError} You can still hear everyone. Tap to retry.</Text>
        </Pressable>
      )}
      {sharer && (
        <View style={{ aspectRatio: 16 / 9, backgroundColor: 'black', marginHorizontal: 8, borderRadius: 10, overflow: 'hidden' }}>
          <VideoView key={`${sharer.id}-${c.v}`} videoTrack={call.getVideoTrack(sharer.id, 'screen')} objectFit="contain" style={{ flex: 1 }} />
          <Text style={{ position: 'absolute', left: 8, bottom: 6, color: 'white', backgroundColor: '#0009', paddingHorizontal: 6, borderRadius: 4 }}>
            {sharer.isLocal ? 'Your screen' : `${memberName(view, sharer.id)}'s screen`}
          </Text>
        </View>
      )}
      <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 }}>
        {c.participants.map((p) => {
          const member = view?.members[p.id];
          const camTrack = p.cameraOn ? call.getVideoTrack(p.id, 'camera') : undefined;
          return (
            <Pressable
              key={p.id}
              onLongPress={() => !p.isLocal && participantMenu(sessionId, p.id, p.volume)}
              style={{ width: '48%', aspectRatio: 1.2, backgroundColor: C.side, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: p.speaking ? C.ok : 'transparent' }}
            >
              {camTrack ? (
                <VideoView key={`${p.id}-cam-${c.v}`} videoTrack={camTrack} objectFit="cover" mirror={p.isLocal} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
              ) : (
                <Avatar name={memberName(view, p.id)} url={member?.user.avatarUrl} staticUrl={member?.user.avatarStaticUrl} size={56} speaking={p.speaking} />
              )}
              <Text style={{ position: 'absolute', left: 6, bottom: 6, color: 'white', backgroundColor: '#0009', paddingHorizontal: 6, borderRadius: 4, fontSize: 12 }}>
                {p.serverMuted ? '🔇 MOD MUTED · ' : p.micMuted ? '🔇 ' : ''}
                {memberName(view, p.id)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {c.ptt && !c.serverMuted && (
        <Pressable
          onPressIn={() => call.setPttPressed(true)}
          onPressOut={() => call.setPttPressed(false)}
          style={({ pressed }) => ({ marginHorizontal: 16, marginBottom: 8, borderRadius: 14, paddingVertical: 16, backgroundColor: pressed ? C.ok : C.field, alignItems: 'center' })}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Hold to talk</Text>
        </Pressable>
      )}
      <View style={[s.row, { justifyContent: 'center', gap: 12, paddingTop: 8, paddingBottom: insets.bottom + 10 }]}>
        <RoundBtn label="Mute" icon={<Text style={{ fontSize: 20 }}>{c.mic ? '🎙️' : '🔇'}</Text>} off={!c.mic} onPress={() => call.toggleMic()} />
        <RoundBtn label="Deafen" icon={<Text style={{ fontSize: 20 }}>{c.deaf ? '🙉' : '🎧'}</Text>} off={c.deaf} onPress={() => call.toggleDeafen()} />
        <RoundBtn label="Camera" icon={<Text style={{ fontSize: 20 }}>📷</Text>} active={c.cam} onPress={() => call.toggleCamera()} />
        <RoundBtn label="Share screen" icon={<Text style={{ fontSize: 20 }}>🖥️</Text>} active={c.screen} onPress={() => call.toggleScreenShare()} />
        {Platform.OS === 'ios' && <RoundBtn label="Audio output" icon={<Text style={{ fontSize: 20 }}>🔈</Text>} onPress={() => AudioSession.showAudioRoutePicker()} />}
        <RoundBtn label="Leave" icon={<Text style={{ fontSize: 20 }}>📵</Text>} danger onPress={leave} />
      </View>
    </View>
  );
}

function participantMenu(sessionId: string, userId: string, volume: number) {
  const view = zz.state.sessions[sessionId];
  const channelId = call.state.channelId!;
  const target = view?.members[userId];
  const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [
    { text: volume > 0 ? 'Mute for me' : 'Unmute for me', onPress: () => call.setUserVolume(userId, volume > 0 ? 0 : 1) },
    { text: 'Volume 200%', onPress: () => call.setUserVolume(userId, 2) },
  ];
  if (view && canModerate(view.myRole, target?.role) && can(view.myRole, 'voice.serverMute')) {
    const muted = !!target?.serverMuted;
    buttons.push({ text: muted ? 'Remove server mute' : 'Server mute (in this session)', onPress: () => zz.attempt(() => zz.api.serverMute(sessionId, userId, !muted)) });
    buttons.push({ text: 'Disconnect from channel', style: 'destructive', onPress: () => zz.attempt(() => zz.api.channelKick(channelId, userId)) });
  }
  buttons.push({ text: 'Cancel', style: 'cancel' });
  Alert.alert(memberName(view, userId), undefined, buttons);
}

// ---------------------------------------------------------------- members

function MembersTab({ sessionId }: { sessionId: string }) {
  const { view, meId } = useApp((st) => ({ view: st.sessions[sessionId], meId: st.me!.id }));
  const [selected, setSelected] = useState<string | null>(null);
  if (!view) return null;
  const order = new Map(view.presence.present.map((p, i) => [p.userId, i]));
  const online = Object.values(view.members).filter((m) => order.has(m.user.id)).sort((a, b) => order.get(a.user.id)! - order.get(b.user.id)!);
  const away = Object.values(view.members).filter((m) => !order.has(m.user.id));
  const row = (m: (typeof online)[number], present: boolean) => (
    <Pressable key={m.user.id} onPress={() => setSelected(m.user.id)} style={[s.row, { gap: 10, paddingVertical: 8, opacity: present ? 1 : 0.45 }]}>
      <Avatar name={memberName(view, m.user.id)} url={m.user.avatarUrl} staticUrl={m.user.avatarStaticUrl} size={36} status={present ? m.user.status : null} />
      <Text style={[s.text, s.flex, { color: m.role === 'OWNER' ? C.owner : m.role === 'MOD' ? C.mod : C.fg }]} numberOfLines={1}>
        {memberName(view, m.user.id)} {view.presence.hostId === m.user.id ? '👑' : ''}
      </Text>
      <RoleBadge role={m.role} />
    </Pressable>
  );
  const sel = selected ? view.members[selected] : undefined;
  const mayMod = sel && sel.user.id !== meId && canModerate(view.myRole, sel.role);
  const act = (fn: () => Promise<unknown>, msg: string) => async () => {
    setSelected(null);
    if ((await zz.attempt(fn)) !== undefined) zz.notify(msg, 'success');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Text style={s.label}>Here now — {online.length}</Text>
      {online.map((m) => row(m, true))}
      {away.length > 0 && <Text style={[s.label, { marginTop: 14 }]}>Away — {away.length}</Text>}
      {away.map((m) => row(m, false))}
      <Sheet visible={!!sel} title={sel ? memberName(view, sel.user.id) : ''} onClose={() => setSelected(null)}>
        {sel && (
          <>
            <Banner user={sel.user} height={90} />
            <View style={[s.row, { gap: 12, marginTop: -30, paddingHorizontal: 10 }]}>
              <Avatar name={sel.user.displayName} url={sel.user.avatarUrl} staticUrl={sel.user.avatarStaticUrl} size={68} status={sel.user.status} animate />
            </View>
            <View style={[s.row, { gap: 8 }]}>
              <Text style={s.h1}>{sel.nickname || sel.user.displayName}</Text>
              <RoleBadge role={sel.role} />
            </View>
            <Pressable onPress={async () => (await Clipboard.setStringAsync(sel.user.publicId), zz.notify('ID copied', 'success'))}>
              <Text style={[s.muted, { fontFamily: 'Menlo' }]}>{sel.user.publicId} ⧉</Text>
            </Pressable>
            {sel.user.bio ? <Text style={[s.card, s.text]}>{sel.user.bio}</Text> : null}
            {view.myRole === 'OWNER' && sel.user.id !== meId && sel.role !== 'OWNER' && (
              <Btn
                variant="secondary"
                title={sel.role === 'MOD' ? 'Remove moderator' : 'Make moderator'}
                onPress={sel.role === 'MOD' ? act(() => zz.api.removeMod(sessionId, sel.user.id), 'Moderator removed') : act(() => zz.api.addMod(sessionId, sel.user.publicId), 'Moderator added')}
              />
            )}
            {view.myRole === 'OWNER' && sel.user.id !== meId && (
              <Btn variant="secondary" title="Transfer ownership" onPress={act(() => zz.api.transferOwnership(sessionId, sel.user.publicId), 'Ownership transferred')} />
            )}
            {mayMod && can(view.myRole, 'voice.serverMute') && (
              <Btn
                variant="secondary"
                title={sel.serverMuted ? 'Remove server mute' : 'Server mute (can’t talk in voice)'}
                onPress={act(() => zz.api.serverMute(sessionId, sel.user.id, !sel.serverMuted), sel.serverMuted ? 'Server mute removed' : 'Server muted')}
              />
            )}
            {mayMod && <Btn variant="danger" title="Kick from session" onPress={act(() => zz.api.kick(sessionId, sel.user.id), 'Kicked')} />}
            {mayMod && <Btn variant="danger" title="Ban from session" onPress={act(() => zz.api.ban(sessionId, { userId: sel.user.id }), 'Banned')} />}
          </>
        )}
      </Sheet>
    </ScrollView>
  );
}
