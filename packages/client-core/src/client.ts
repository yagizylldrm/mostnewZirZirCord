import { io, type Socket } from 'socket.io-client';
import type {
  AttachmentKind,
  AuthResponse,
  ClientToServerEvents,
  MessageDTO,
  NotifySettingsInput,
  ServerToClientEvents,
  SessionSnapshot,
  UpdateProfileInput,
} from '@zirzircord/shared';
import { ApiClient, ApiError, putWithProgress } from './api';
import type { PlatformConfig } from './platform';
import { randomId } from './platform';
import {
  createAppStore,
  isChannelMuted,
  isSessionMuted,
  memberName,
  mentionsToText,
  type AppState,
  type LocalMessage,
  type SessionView,
  sortChannels,
} from './store';

export interface OutgoingFile {
  blob: Blob;
  filename: string;
  mime: string;
  kind: AttachmentKind;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
}

const K_OPEN = 'zz.openSessions';
const K_ACTIVE = 'zz.activeSession';

/** What the platform needs to show a notification (desktop/browser/in-app). */
export interface IncomingNotification {
  sessionId: string;
  channelId: string;
  sessionName: string;
  channelName: string;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  isMention: boolean;
}

export function guessKind(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  return 'FILE';
}

/**
 * The ZirZirCord client: owns the API client, the realtime socket and the app
 * store. UI layers (web, desktop, mobile) only read the store and call methods.
 */
export class ZirZirClient {
  readonly api: ApiClient;
  readonly store = createAppStore();
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private noticeId = 0;
  private lastTyping = 0;
  /** Called when the user is removed from a session (lets the call manager hang up). */
  onSessionGone: (sessionId: string) => void = () => {};
  /** Platform hook: show a notification. */
  onNotify: (n: IncomingNotification) => void = () => {};
  /** Platform hook: message / mention sound effects. */
  onSound: (event: 'message' | 'mention') => void = () => {};
  /** Which text channel the user is looking at, and whether the window has focus. */
  private viewing: { channelId: string | null; focused: boolean } = { channelId: null, focused: true };

  constructor(private config: PlatformConfig) {
    this.api = new ApiClient(config.apiUrl, config.storage);
    this.api.onAuthLost = () => this.resetToSignedOut();
  }

  get state(): AppState {
    return this.store.getState();
  }
  private set(partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    this.store.setState(partial as any);
  }

  notify(text: string, kind: 'info' | 'error' | 'success' = 'info') {
    const id = ++this.noticeId;
    this.set((s) => ({ notices: [...s.notices, { id, kind, text }] }));
    setTimeout(() => this.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), 5000);
  }

  /** Runs an action and turns errors into notices. Returns undefined on failure. */
  async attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      this.notify(e instanceof Error ? e.message : String(e), 'error');
      return undefined;
    }
  }

  // ---------------------------------------------------------------- startup

  async start() {
    const hasTokens = await this.api.init();
    if (hasTokens) {
      try {
        await this.loadCurrentAccount();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await this.api.setTokens(null);
        else this.notify('Cannot reach the server. Retrying…', 'error');
      }
    }
    this.set({ ready: true, accounts: this.api.accounts() });
  }

  /** Loads the active account's profile and reconnects it. */
  private async loadCurrentAccount() {
    const me = await this.api.me();
    await this.api.rememberUser(me);
    this.set({ me, accounts: this.api.accounts() });
    await this.afterSignIn();
  }

  private openKey() {
    return `${K_OPEN}.${this.state.me?.id}`;
  }
  private activeKey() {
    return `${K_ACTIVE}.${this.state.me?.id}`;
  }

  private async afterSignIn() {
    this.connectSocket();
    await this.refreshSidebar();
    const open: string[] = JSON.parse((await this.config.storage.get(this.openKey())) ?? (await this.config.storage.get(K_OPEN)) ?? '[]');
    const active = await this.config.storage.get(this.activeKey());
    for (const sid of open) await this.enterSession(sid, { quiet: true, activate: false });
    if (active && this.state.sessions[active]) this.setActiveSession(active);
    else if (Object.keys(this.state.sessions)[0]) this.setActiveSession(Object.keys(this.state.sessions)[0]);
  }

  // --------------------------------------------------------------- accounts

  async guest(displayName: string) {
    await this.signIn(await this.api.guest(displayName));
  }
  async register(displayName: string, email: string, password: string) {
    await this.signIn(await this.api.register(displayName, email, password));
  }
  async login(email: string, password: string) {
    await this.signIn(await this.api.login(email, password));
  }

  /** Activates a freshly authenticated account (leaving the previous one's sessions first). */
  private async signIn(r: AuthResponse) {
    if (this.state.me) await this.teardown();
    await this.api.activate(r.user, { accessToken: r.accessToken, refreshToken: r.refreshToken });
    this.set({ me: r.user, addingAccount: false, accounts: this.api.accounts() });
    await this.afterSignIn();
  }

  async upgrade(email: string, password: string) {
    const me = await this.api.upgrade(email, password);
    await this.api.rememberUser(me);
    this.set({ me, accounts: this.api.accounts() });
  }

  /** Shows the sign-in screen to add another account (current one stays saved). */
  beginAddAccount() {
    this.set({ addingAccount: true });
  }
  cancelAddAccount() {
    this.set({ addingAccount: false });
  }

  async switchAccount(userId: string) {
    if (userId === this.state.me?.id) return;
    await this.teardown();
    if (!(await this.api.switchTo(userId))) return this.afterAccountGone();
    try {
      await this.loadCurrentAccount();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const wasGuest = this.api.accounts().find((a) => a.id === userId)?.isGuest;
        this.notify(
          wasGuest ? 'That guest account was deleted after being offline for a day.' : 'That account was signed out. Please sign in again.',
          'error',
        );
        await this.api.removeAccount(userId);
        return this.afterAccountGone();
      }
      throw e;
    }
  }

  /** Logs out the current account only; switches to another saved account if there is one. */
  async logout() {
    await this.teardown();
    await this.api.logout();
    await this.afterAccountGone();
  }

  /**
   * Permanently deletes the current account (registered accounts confirm with
   * their password), then continues with another saved account if there is one.
   * Throws (and stays signed in) when the password is wrong.
   */
  async deleteAccount(password?: string) {
    this.deletingAccount = true; // the server's own 'account:deleted' echo is handled here, not by the listener
    try {
      await this.api.deleteMe(password);
    } catch (e) {
      this.deletingAccount = false;
      throw e;
    }
    await this.teardown().catch(() => {});
    this.deletingAccount = false;
    await this.afterAccountGone();
  }
  private deletingAccount = false;

  private async afterAccountGone() {
    const next = this.api.accounts()[0];
    this.set({ me: null, accounts: this.api.accounts(), addingAccount: false });
    if (next) await this.switchAccount(next.id).catch(() => {});
  }

  /** Leaves every open session and disconnects, so another account can take over. */
  private async teardown() {
    const sids = Object.keys(this.state.sessions);
    await Promise.all(
      sids.map(
        (sid) =>
          new Promise<void>((resolve) => {
            this.onSessionGone(sid);
            if (!this.socket?.connected) return resolve();
            this.socket.timeout(4000).emit('session:exit', sid, () => resolve());
          }),
      ),
    );
    this.socket?.disconnect();
    this.socket = null;
    this.set(this.emptyAccountState());
  }

  private emptyAccountState(): Partial<AppState> {
    return {
      connected: false,
      sessions: {},
      sidebar: { setSessions: [], openSessions: [] },
      activeSessionId: null,
      activeChannel: {},
      messages: {},
      typing: {},
      uploads: [],
      unread: {},
      notify: {},
      channelMutes: {},
      stickers: null,
    };
  }

  private resetToSignedOut() {
    for (const sid of Object.keys(this.state.sessions)) this.onSessionGone(sid);
    this.socket?.disconnect();
    this.socket = null;
    this.set({ ...this.emptyAccountState(), me: null, accounts: this.api.accounts() });
  }

  async refreshSidebar() {
    const r = await this.api.mySessions().catch(() => null);
    if (r) this.set({ sidebar: r });
  }

  private async persistOpen() {
    if (!this.state.me) return;
    await this.config.storage.set(this.openKey(), JSON.stringify(Object.keys(this.state.sessions)));
    if (this.state.activeSessionId) await this.config.storage.set(this.activeKey(), this.state.activeSessionId);
  }

  // ---------------------------------------------------------------- socket

  private connectSocket() {
    this.socket?.disconnect();
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(this.config.apiUrl, {
      transports: ['websocket'],
      auth: (cb) => {
        this.api.freshAccessToken().then((token) => cb({ token }));
      },
      reconnectionDelayMax: 5000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.set({ connected: true });
      // Re-enter every open session (refreshes snapshots after reconnects).
      for (const sid of Object.keys(this.state.sessions)) this.enterSession(sid, { quiet: true, activate: false });
    });
    socket.on('disconnect', () => this.set({ connected: false }));

    const updateView = (sid: string, fn: (v: SessionView) => Partial<SessionView>) =>
      this.set((s) => {
        const v = s.sessions[sid];
        return v ? { sessions: { ...s.sessions, [sid]: { ...v, ...fn(v) } } } : {};
      });

    socket.on('session:updated', (session) => {
      updateView(session.id, () => ({ session }));
      this.set((s) => ({
        sidebar: {
          setSessions: s.sidebar.setSessions.map((i) => (i.session.id === session.id ? { ...i, session } : i)),
          openSessions: s.sidebar.openSessions.map((i) => (i.session.id === session.id ? { ...i, session } : i)),
        },
      }));
      if (session.isSet !== undefined) this.refreshSidebar();
    });
    socket.on('session:closed', ({ sessionId, reason }) => {
      const name = this.state.sessions[sessionId]?.session.name;
      this.dropSession(sessionId);
      if (reason === 'deleted' && name) this.notify(`"${name}" was deleted by its owner`);
      this.refreshSidebar();
    });
    socket.on('session:removed', ({ sessionId, reason }) => {
      const name = this.state.sessions[sessionId]?.session.name ?? 'a session';
      this.dropSession(sessionId);
      this.notify(reason === 'banned' ? `You were banned from "${name}"` : `You were kicked from "${name}"`, 'error');
      this.refreshSidebar();
    });
    socket.on('presence:update', (presence) => updateView(presence.sessionId, () => ({ presence })));
    socket.on('member:upsert', ({ sessionId, member }) => {
      updateView(sessionId, (v) => ({ members: { ...v.members, [member.user.id]: member } }));
      if (member.user.id === this.state.me?.id) updateView(sessionId, () => ({ myRole: member.role }));
    });
    // Our account was deleted (e.g. from another device): forget it here too.
    socket.on('account:deleted', ({ userId }) => {
      if (userId !== this.state.me?.id || this.deletingAccount) return;
      void (async () => {
        await this.teardown().catch(() => {});
        await this.api.removeAccount(userId);
        this.notify('This account was deleted.', 'info');
        await this.afterAccountGone();
      })();
    });
    // Someone deleted their account: loaded messages from them become "Deleted user".
    socket.on('user:deleted', ({ userId }) =>
      this.set((s) => {
        let changed = false;
        const messages = { ...s.messages };
        for (const [cid, cm] of Object.entries(s.messages)) {
          if (!cm.items.some((m) => m.authorId === userId)) continue;
          changed = true;
          messages[cid] = { ...cm, items: cm.items.map((m) => (m.authorId === userId ? { ...m, authorId: null } : m)) };
        }
        return changed ? { messages } : {};
      }),
    );
    socket.on('member:removed', ({ sessionId, userId }) =>
      updateView(sessionId, (v) => {
        const members = { ...v.members };
        delete members[userId];
        return { members };
      }),
    );
    socket.on('channel:upsert', (c) =>
      updateView(c.sessionId, (v) => ({ channels: sortChannels([...v.channels.filter((x) => x.id !== c.id), c]) })),
    );
    const removeChannel = (sessionId: string, channelId: string) => {
      updateView(sessionId, (v) => ({ channels: v.channels.filter((c) => c.id !== channelId) }));
      if (this.state.activeChannel[sessionId] === channelId) {
        const first = this.state.sessions[sessionId]?.channels.find((c) => c.type === 'TEXT');
        if (first) this.setActiveChannel(sessionId, first.id);
      }
    };
    socket.on('channel:deleted', ({ sessionId, channelId }) => removeChannel(sessionId, channelId));
    socket.on('channel:removed', ({ sessionId, channelId, reason }) => {
      const ch = this.state.sessions[sessionId]?.channels.find((c) => c.id === channelId);
      if (reason === 'banned') removeChannel(sessionId, channelId);
      this.onChannelGone(channelId);
      if (ch) this.notify(`You were ${reason} from ${ch.type === 'TEXT' ? '#' : ''}${ch.name}`, 'error');
    });
    socket.on('message:new', (m) => {
      this.handleIncoming(m);
      this.upsertMessage(m);
    });
    socket.on('message:updated', (m) => this.upsertMessage(m, true));
    socket.on('message:deleted', ({ channelId, messageId }) =>
      this.set((s) => {
        const cm = s.messages[channelId];
        return cm ? { messages: { ...s.messages, [channelId]: { ...cm, items: cm.items.filter((x) => x.id !== messageId) } } } : {};
      }),
    );
    socket.on('typing', ({ channelId, userId }) =>
      this.set((s) => ({ typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [userId]: Date.now() + 6000 } } })),
    );
    socket.on('voice:state', ({ sessionId, channelId, participants }) =>
      updateView(sessionId, (v) => ({ voice: { ...v.voice, [channelId]: participants } })),
    );
    socket.on('user:updated', (user) => {
      this.set((s) => {
        const sessions = { ...s.sessions };
        for (const [sid, v] of Object.entries(sessions)) {
          const m = v.members[user.id];
          if (m) sessions[sid] = { ...v, members: { ...v.members, [user.id]: { ...m, user } } };
        }
        return { sessions, me: s.me && s.me.id === user.id ? { ...s.me, ...user } : s.me };
      });
      if (user.id === this.state.me?.id) this.api.rememberUser(this.state.me).then(() => this.set({ accounts: this.api.accounts() }));
    });
  }

  /** Hook for the call manager: a channel became inaccessible. */
  onChannelGone: (channelId: string) => void = () => {};

  private upsertMessage(m: LocalMessage, updateOnly = false) {
    this.set((s) => {
      const cm = s.messages[m.channelId];
      if (!cm?.loaded) return {};
      // The server's copy of our own optimistic message replaces it in place (matched by nonce).
      const local = m.nonce && !m.pending ? cm.items.findIndex((x) => x.pending !== undefined && x.nonce === m.nonce) : -1;
      const idx = local !== -1 ? local : cm.items.findIndex((x) => x.id === m.id);
      if (idx === -1 && updateOnly) return {};
      let items = idx === -1 ? [...cm.items, m] : cm.items.map((x, i) => (i === idx ? m : x));
      // If the realtime copy already arrived, drop the duplicate.
      if (local !== -1) items = items.filter((x, i) => i === local || x.id !== m.id);
      const typing = { ...s.typing[m.channelId] };
      if (m.authorId) delete typing[m.authorId];
      return { messages: { ...s.messages, [m.channelId]: { ...cm, items } }, typing: { ...s.typing, [m.channelId]: typing } };
    });
  }

  private dropSession(sessionId: string) {
    this.onSessionGone(sessionId);
    this.set((s) => {
      const sessions = { ...s.sessions };
      const view = sessions[sessionId];
      delete sessions[sessionId];
      const messages = { ...s.messages };
      const unread = { ...s.unread };
      view?.channels.forEach((c) => {
        delete messages[c.id];
        delete unread[c.id];
      });
      const remaining = Object.keys(sessions);
      return {
        sessions,
        messages,
        unread,
        activeSessionId: s.activeSessionId === sessionId ? (remaining[0] ?? null) : s.activeSessionId,
      };
    });
    this.persistOpen();
  }

  // -------------------------------------------------------------- sessions

  private emitEnter(sessionId: string): Promise<SessionSnapshot> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Not connected'));
      const go = () =>
        this.socket!.timeout(10_000).emit('session:enter', sessionId, (err: any, res: any) => {
          if (err) return reject(new Error('Server did not respond'));
          if (res.ok) resolve(res.data);
          else reject(new ApiError(400, res.error, res.message));
        });
      if (this.socket.connected) go();
      else this.socket.once('connect', go);
    });
  }

  async enterSession(sessionId: string, opts: { quiet?: boolean; activate?: boolean } = {}) {
    try {
      const snap = await this.emitEnter(sessionId);
      const view: SessionView = {
        session: snap.session,
        myRole: snap.myRole,
        members: Object.fromEntries(snap.members.map((m) => [m.user.id, m])),
        channels: sortChannels(snap.channels),
        presence: snap.presence,
        voice: snap.voice,
      };
      this.set((s) => {
        const current = s.activeChannel[sessionId];
        const stillThere = current && view.channels.some((c) => c.id === current);
        const firstText = view.channels.find((c) => c.type === 'TEXT')?.id;
        return {
          sessions: { ...s.sessions, [sessionId]: view },
          notify: { ...s.notify, [sessionId]: snap.notify },
          channelMutes: { ...s.channelMutes, [sessionId]: snap.channelMutes },
          activeChannel: stillThere || !firstText ? s.activeChannel : { ...s.activeChannel, [sessionId]: firstText },
        };
      });
      if (opts.activate !== false) this.setActiveSession(sessionId);
      // Reload loaded channels after reconnect so nothing is missed.
      for (const c of view.channels) if (this.state.messages[c.id]?.loaded) this.loadMessages(c.id, true);
      await this.persistOpen();
      return view;
    } catch (e) {
      if (opts.quiet) {
        this.dropSession(sessionId);
        return undefined;
      }
      throw e;
    }
  }

  setActiveSession(sessionId: string | null) {
    this.set({ activeSessionId: sessionId });
    this.persistOpen();
  }

  setActiveChannel(sessionId: string, channelId: string) {
    this.set((s) => ({ activeChannel: { ...s.activeChannel, [sessionId]: channelId } }));
    this.markRead(channelId);
  }

  // ---------------------------------------------------- unread & notifications

  /** The UI reports which text channel is on screen and whether the window is focused. */
  setViewing(channelId: string | null, focused: boolean) {
    this.viewing = { channelId, focused };
    if (channelId && focused) this.markRead(channelId);
  }

  markRead(channelId: string) {
    if (!this.state.unread[channelId]) return;
    this.set((s) => {
      const unread = { ...s.unread };
      delete unread[channelId];
      return { unread };
    });
  }

  private handleIncoming(m: MessageDTO) {
    const me = this.state.me;
    if (!me || m.authorId === me.id) return;
    const sessionId = Object.keys(this.state.sessions).find((sid) => this.state.sessions[sid].channels.some((c) => c.id === m.channelId));
    if (!sessionId) return;
    const view = this.state.sessions[sessionId];
    const isMention = m.mentions.includes(me.id) || m.mentionsEveryone;
    if (this.viewing.channelId === m.channelId && this.viewing.focused) return;

    this.set((s) => {
      const u = s.unread[m.channelId] ?? { count: 0, mentions: 0 };
      return { unread: { ...s.unread, [m.channelId]: { count: u.count + 1, mentions: u.mentions + (isMention ? 1 : 0) } } };
    });

    const st = this.state;
    const level = st.notify[sessionId]?.level ?? 'ALL';
    if (isSessionMuted(st, sessionId) || isChannelMuted(st, sessionId, m.channelId) || level === 'NONE') return;
    if (level === 'MENTIONS' && !isMention) return;
    this.onSound(isMention ? 'mention' : 'message');
    const author = m.authorId ? view.members[m.authorId] : undefined;
    const text = m.content
      ? mentionsToText(m.content, view)
      : m.attachments[0]?.kind === 'STICKER'
        ? 'sent a sticker'
        : m.attachments[0]?.kind === 'VOICE_MESSAGE'
          ? '🎙️ Voice message'
          : '📎 Attachment';
    this.onNotify({
      sessionId,
      channelId: m.channelId,
      sessionName: view.session.name,
      channelName: view.channels.find((c) => c.id === m.channelId)?.name ?? '',
      authorName: memberName(view, m.authorId),
      authorAvatarUrl: author?.user.avatarStaticUrl ?? null,
      text,
      isMention,
    });
  }

  async setSessionNotify(sessionId: string, input: NotifySettingsInput) {
    const notify = await this.api.setSessionNotify(sessionId, input);
    this.set((s) => ({ notify: { ...s.notify, [sessionId]: notify } }));
  }

  /** mutedUntil: ISO date, null = until turned back on, 'unmute' = remove. */
  async setChannelMute(sessionId: string, channelId: string, mutedUntil: string | null | 'unmute') {
    if (mutedUntil === 'unmute') await this.api.unmuteChannel(channelId);
    else await this.api.muteChannel(channelId, mutedUntil);
    this.set((s) => {
      const mutes = { ...s.channelMutes[sessionId] };
      if (mutedUntil === 'unmute') delete mutes[channelId];
      else mutes[channelId] = mutedUntil;
      return { channelMutes: { ...s.channelMutes, [sessionId]: mutes } };
    });
  }

  async createSession(name: string, isSet = false) {
    const s = await this.api.createSession(name, isSet);
    await this.enterSession(s.id);
    this.refreshSidebar();
    return s;
  }

  async joinByCode(code: string) {
    const s = await this.api.joinSession(code);
    await this.enterSession(s.id);
    this.refreshSidebar();
    return s;
  }

  /** Clicking a set session: reopens it (you become host) or joins the live one. */
  async openSession(sessionId: string) {
    if (this.state.sessions[sessionId]) return this.setActiveSession(sessionId);
    await this.enterSession(sessionId);
    this.refreshSidebar();
  }

  async leaveSession(sessionId: string) {
    await new Promise<void>((resolve) => {
      if (!this.socket?.connected) return resolve();
      this.socket.timeout(5000).emit('session:exit', sessionId, () => resolve());
    });
    this.dropSession(sessionId);
    this.refreshSidebar();
  }

  // -------------------------------------------------------------- messages

  async loadMessages(channelId: string, force = false) {
    const cur = this.state.messages[channelId];
    if (cur?.loading || (cur?.loaded && !force)) return;
    this.set((s) => ({ messages: { ...s.messages, [channelId]: { items: cur?.items ?? [], hasMore: false, loaded: !!cur?.loaded, loading: true } } }));
    try {
      const r = await this.api.messages(channelId);
      this.set((s) => {
        // Keep our own unsent / failed messages across reloads (e.g. after a reconnect).
        const local = (s.messages[channelId]?.items ?? []).filter((x) => x.pending !== undefined);
        return { messages: { ...s.messages, [channelId]: { items: [...r.messages, ...local], hasMore: r.hasMore, loaded: true, loading: false } } };
      });
    } catch (e) {
      this.set((s) => ({ messages: { ...s.messages, [channelId]: { items: [], hasMore: false, loaded: false, loading: false } } }));
      throw e;
    }
  }

  async loadOlder(channelId: string) {
    const cur = this.state.messages[channelId];
    if (!cur?.loaded || cur.loading || !cur.hasMore || !cur.items[0]) return;
    this.set((s) => ({ messages: { ...s.messages, [channelId]: { ...cur, loading: true } } }));
    const r = await this.api.messages(channelId, cur.items[0].id);
    this.set((s) => {
      const now = s.messages[channelId];
      const ids = new Set(now.items.map((m) => m.id));
      return {
        messages: {
          ...s.messages,
          [channelId]: { ...now, items: [...r.messages.filter((m) => !ids.has(m.id)), ...now.items], hasMore: r.hasMore, loading: false },
        },
      };
    });
  }

  /** Pending sends that can be retried after a failure (nonce → what was sent). */
  private outbox = new Map<string, () => Promise<MessageDTO>>();

  /** Adds the sender's message to the chat immediately; the server copy replaces it when it arrives. */
  private showPending(channelId: string, nonce: string, content: string, extra: Partial<LocalMessage> = {}) {
    const me = this.state.me;
    if (!me) return;
    this.upsertMessage({
      id: `local-${nonce}`,
      nonce,
      channelId,
      authorId: me.id,
      content,
      replyToId: null,
      mentions: [],
      mentionsEveryone: false,
      attachments: [],
      createdAt: new Date().toISOString(),
      editedAt: null,
      pending: true,
      ...extra,
    });
  }

  private setLocalState(channelId: string, nonce: string, patch: Partial<LocalMessage>) {
    this.set((s) => {
      const cm = s.messages[channelId];
      if (!cm) return {};
      return { messages: { ...s.messages, [channelId]: { ...cm, items: cm.items.map((x) => (x.nonce === nonce && x.pending !== undefined ? { ...x, ...patch } : x)) } } };
    });
  }

  /** Runs a send with an optimistic bubble; failures leave a "failed" bubble with Retry/Delete. */
  private async sendOptimistic(channelId: string, nonce: string, run: () => Promise<MessageDTO>) {
    this.outbox.set(nonce, run);
    try {
      const msg = await run();
      this.outbox.delete(nonce);
      this.upsertMessage(msg);
      return msg;
    } catch (e) {
      this.setLocalState(channelId, nonce, { failed: true });
      this.notify(e instanceof Error ? e.message : String(e), 'error');
      return undefined;
    }
  }

  /** Retry a failed message. */
  async retrySend(channelId: string, nonce: string) {
    const run = this.outbox.get(nonce);
    if (!run) return;
    this.setLocalState(channelId, nonce, { failed: false });
    await this.sendOptimistic(channelId, nonce, run);
  }

  /** Remove a failed message without sending it. */
  discardFailed(channelId: string, nonce: string) {
    this.outbox.delete(nonce);
    this.set((s) => {
      const cm = s.messages[channelId];
      return cm ? { messages: { ...s.messages, [channelId]: { ...cm, items: cm.items.filter((x) => !(x.nonce === nonce && x.pending !== undefined)) } } } : {};
    });
  }

  async sendMessage(sessionId: string, channelId: string, content: string, files: OutgoingFile[] = [], replyToId?: string) {
    const nonce = randomId();
    this.showPending(channelId, nonce, content, {
      replyToId: replyToId ?? null,
      localFiles: files.map((f) => ({ filename: f.filename, kind: f.kind })),
    });
    // Uploads happen once; a retry only re-sends the message itself.
    let uploaded: Promise<string[]> | null = null;
    return this.sendOptimistic(channelId, nonce, async () => {
      uploaded ??= this.uploadFiles(sessionId, channelId, files);
      const attachmentIds = await uploaded.catch((e) => {
        uploaded = null; // let Retry upload again
        throw e;
      });
      return this.api.sendMessage(channelId, { content, attachmentIds, replyToId, nonce });
    });
  }

  private async uploadFiles(sessionId: string, channelId: string, files: OutgoingFile[]) {
    const attachmentIds: string[] = [];
    for (const f of files) {
      const uploadId = randomId();
      this.set((s) => ({ uploads: [...s.uploads, { id: uploadId, channelId, filename: f.filename, progress: 0 }] }));
      try {
        const ticket = await this.api.uploadTicket(sessionId, {
          filename: f.filename,
          mime: f.mime || 'application/octet-stream',
          size: f.blob.size,
          kind: f.kind,
          width: f.width,
          height: f.height,
          durationMs: f.durationMs,
          waveform: f.waveform,
        });
        await putWithProgress(ticket.uploadUrl, f.blob, ticket.headers, (p) =>
          this.set((s) => ({ uploads: s.uploads.map((u) => (u.id === uploadId ? { ...u, progress: p } : u)) })),
        );
        attachmentIds.push(ticket.attachmentId);
      } finally {
        this.set((s) => ({ uploads: s.uploads.filter((u) => u.id !== uploadId) }));
      }
    }
    return attachmentIds;
  }

  sendTyping(channelId: string) {
    const now = Date.now();
    if (now - this.lastTyping < 3000) return;
    this.lastTyping = now;
    this.socket?.emit('typing', channelId);
  }

  // --------------------------------------------------------------- profile

  async updateProfile(input: UpdateProfileInput) {
    const me = await this.api.updateProfile(input);
    await this.api.rememberUser(me);
    this.set({ me, accounts: this.api.accounts() });
    return me;
  }

  /** Uploads a raw image for an avatar / banner / sticker and returns its upload id. */
  async uploadMedia(purpose: 'avatar' | 'banner' | 'sticker', blob: Blob, mime: string) {
    const ticket = await this.api.mediaUploadTicket(purpose, mime, blob.size);
    await putWithProgress(ticket.uploadUrl, blob, ticket.headers);
    return ticket.attachmentId;
  }

  async uploadAvatar(blob: Blob, mime: string) {
    return this.updateProfile({ avatarUploadId: await this.uploadMedia('avatar', blob, mime) });
  }
  async uploadBanner(blob: Blob, mime: string) {
    return this.updateProfile({ bannerUploadId: await this.uploadMedia('banner', blob, mime) });
  }

  // -------------------------------------------------------------- stickers

  async loadStickers(force = false) {
    if (this.state.stickers && !force) return this.state.stickers;
    const stickers = await this.api.stickers();
    this.set({ stickers });
    return stickers;
  }
  async createSticker(blob: Blob, mime: string) {
    const sticker = await this.api.createSticker(await this.uploadMedia('sticker', blob, mime));
    this.set((s) => ({ stickers: [sticker, ...(s.stickers ?? [])] }));
    return sticker;
  }
  async deleteSticker(id: string) {
    await this.api.deleteSticker(id);
    this.set((s) => ({ stickers: (s.stickers ?? []).filter((x) => x.id !== id) }));
  }
  async saveSticker(attachmentId: string) {
    const sticker = await this.api.saveSticker(attachmentId);
    this.set((s) => ({ stickers: [sticker, ...(s.stickers ?? [])] }));
    return sticker;
  }
  async sendSticker(sessionId: string, channelId: string, stickerId: string) {
    const nonce = randomId();
    const st = this.state.stickers?.find((x) => x.id === stickerId);
    this.showPending(channelId, nonce, '', {
      attachments: st
        ? [{ id: `local-${nonce}`, kind: 'STICKER', filename: 'sticker.webp', mime: 'image/webp', size: 0, url: st.url, thumbnailUrl: st.staticUrl, width: st.width, height: st.height, durationMs: null, waveform: null }]
        : [],
    });
    return this.sendOptimistic(channelId, nonce, () => this.api.sendMessage(channelId, { stickerId, nonce }));
  }
}
