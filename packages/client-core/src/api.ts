import type {
  AuthResponse,
  AuthTokens,
  BanDTO,
  ChannelDTO,
  CreateChannelInput,
  CreateUploadInput,
  MessageDTO,
  NotifySettings,
  NotifySettingsInput,
  PublicUser,
  SelfUser,
  SendMessageInput,
  SessionDTO,
  SetSessionListItem,
  StickerDTO,
  UpdateChannelInput,
  UpdateProfileInput,
  UpdateSessionInput,
  UploadTicket,
  VoiceTokenResponse,
} from '@zirzircord/shared';
import type { KeyValueStorage } from './platform';
import { randomId } from './platform';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const K_TOKENS = 'zz.tokens'; // legacy single-account storage (migrated)
const K_ACCOUNTS = 'zz.accounts';
const K_ACTIVE = 'zz.activeAccount';
const K_DEVICE = 'zz.deviceId';

/** What we remember about each signed-in account on this device. */
export interface AccountSummary {
  id: string;
  displayName: string;
  publicId: string;
  avatarUrl: string | null;
  avatarStaticUrl: string | null;
  isGuest: boolean;
}
interface SavedAccount {
  user: AccountSummary;
  tokens: AuthTokens;
}

/**
 * Thin typed REST client. Refreshes the access token automatically on 401 and
 * persists tokens in the platform storage.
 */
export class ApiClient {
  private tokens: AuthTokens | null = null;
  private saved: SavedAccount[] = [];
  private activeId: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  deviceId = '';
  onAuthLost: () => void = () => {};

  constructor(
    public baseUrl: string,
    private storage: KeyValueStorage,
  ) {}

  async init() {
    this.deviceId = (await this.storage.get(K_DEVICE)) ?? '';
    if (!this.deviceId) {
      this.deviceId = randomId();
      await this.storage.set(K_DEVICE, this.deviceId);
    }
    try {
      this.saved = JSON.parse((await this.storage.get(K_ACCOUNTS)) ?? '[]');
    } catch {
      this.saved = [];
    }
    this.activeId = await this.storage.get(K_ACTIVE);
    this.tokens = this.saved.find((a) => a.user.id === this.activeId)?.tokens ?? null;
    if (!this.tokens) {
      // Migrate the old single-account storage; the account summary is filled in after /me.
      const legacy = await this.storage.get(K_TOKENS);
      this.tokens = legacy ? JSON.parse(legacy) : null;
      this.activeId = null;
    }
    return !!this.tokens;
  }

  get accessToken() {
    return this.tokens?.accessToken ?? null;
  }

  /** Accounts signed in on this device (active one first). */
  accounts(): AccountSummary[] {
    const list = this.saved.map((a) => a.user);
    return [...list.filter((u) => u.id === this.activeId), ...list.filter((u) => u.id !== this.activeId)];
  }

  get activeAccountId() {
    return this.activeId;
  }

  private async persist() {
    await this.storage.set(K_ACCOUNTS, JSON.stringify(this.saved));
    if (this.activeId) await this.storage.set(K_ACTIVE, this.activeId);
    else await this.storage.remove(K_ACTIVE);
    await this.storage.remove(K_TOKENS);
  }

  /** Makes `user` the active account with these tokens (adds it if new). */
  async activate(user: AccountSummary, tokens: AuthTokens) {
    this.saved = [{ user: summarize(user), tokens }, ...this.saved.filter((a) => a.user.id !== user.id)];
    this.activeId = user.id;
    this.tokens = tokens;
    await this.persist();
  }

  /** Refreshes the stored name/avatar of the active account (after /me or a profile edit). */
  async rememberUser(user: AccountSummary) {
    if (!this.tokens) return;
    if (!this.activeId || this.activeId === user.id) await this.activate(user, this.tokens);
  }

  /** Switches to another saved account. Returns false if it isn't saved. */
  async switchTo(userId: string) {
    const acc = this.saved.find((a) => a.user.id === userId);
    if (!acc) return false;
    this.activeId = userId;
    this.tokens = acc.tokens;
    await this.persist();
    return true;
  }

  async removeAccount(userId: string) {
    this.saved = this.saved.filter((a) => a.user.id !== userId);
    if (this.activeId === userId) {
      this.activeId = null;
      this.tokens = null;
    }
    await this.persist();
  }

  async setTokens(t: AuthTokens | null) {
    if (!t) {
      if (this.activeId) return this.removeAccount(this.activeId);
      this.tokens = null;
      await this.storage.remove(K_TOKENS);
      return;
    }
    this.tokens = t;
    const acc = this.saved.find((a) => a.user.id === this.activeId);
    if (acc) acc.tokens = t;
    await this.persist();
  }

  /** Returns a valid access token (refreshing if it is about to expire). */
  async freshAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    try {
      const payload = JSON.parse(atob(this.tokens.accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.exp * 1000 - Date.now() < 60_000) await this.refresh();
    } catch {
      await this.refresh();
    }
    return this.tokens?.accessToken ?? null;
  }

  private refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        if (!this.tokens) return false;
        try {
          const res = await fetch(`${this.baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: this.tokens.refreshToken, deviceId: this.deviceId }),
          });
          if (res.status === 401) {
            await this.setTokens(null);
            this.onAuthLost();
            return false;
          }
          if (!res.ok) return false; // network/server hiccup: keep tokens, try later
          await this.setTokens(await res.json());
          return true;
        } catch {
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(this.tokens ? { authorization: `Bearer ${this.tokens.accessToken}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'network', 'Cannot reach the ZirZirCord server');
    }
    if (res.status === 401 && retry && this.tokens && !path.startsWith('/auth/')) {
      if (await this.refresh()) return this.request<T>(method, path, body, false);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`);
    return data as T;
  }

  // ---------------------------------------------------------------- auth
  // These return the new account WITHOUT activating it, so the caller can first
  // leave the current account's sessions, then call activate().
  guest(displayName: string) {
    return this.request<AuthResponse>('POST', '/auth/guest', { displayName, deviceId: this.deviceId });
  }
  register(displayName: string, email: string, password: string) {
    return this.request<AuthResponse>('POST', '/auth/register', { displayName, email, password, deviceId: this.deviceId });
  }
  login(email: string, password: string) {
    return this.request<AuthResponse>('POST', '/auth/login', { email, password, deviceId: this.deviceId });
  }
  async upgrade(email: string, password: string) {
    return (await this.request<{ user: SelfUser }>('POST', '/auth/upgrade', { email, password })).user;
  }
  /** Signs the active account out on the server and forgets it on this device. */
  async logout() {
    const rt = this.tokens?.refreshToken;
    if (rt) await this.request('POST', '/auth/logout', { refreshToken: rt }).catch(() => {});
    if (this.activeId) await this.removeAccount(this.activeId);
    else await this.setTokens(null);
  }

  // --------------------------------------------------------------- users
  async me() {
    return (await this.request<{ user: SelfUser }>('GET', '/me')).user;
  }
  async updateProfile(input: UpdateProfileInput) {
    return (await this.request<{ user: SelfUser }>('PATCH', '/me', input)).user;
  }
  mediaUploadTicket(purpose: 'avatar' | 'banner' | 'sticker', mime: string, size: number) {
    return this.request<UploadTicket>('POST', '/me/media-upload', { purpose, mime, size });
  }

  // ------------------------------------------------------------ stickers
  async stickers() {
    return (await this.request<{ stickers: StickerDTO[] }>('GET', '/me/stickers')).stickers;
  }
  async createSticker(uploadId: string) {
    return (await this.request<{ sticker: StickerDTO }>('POST', '/me/stickers', { uploadId })).sticker;
  }
  deleteSticker(id: string) {
    return this.request('DELETE', `/me/stickers/${id}`);
  }
  async saveSticker(attachmentId: string) {
    return (await this.request<{ sticker: StickerDTO }>('POST', '/me/stickers/from-attachment', { attachmentId })).sticker;
  }

  // ------------------------------------------------------- notifications
  async setSessionNotify(sessionId: string, input: NotifySettingsInput) {
    return (await this.request<{ notify: NotifySettings }>('PATCH', `/sessions/${sessionId}/notifications`, input)).notify;
  }
  muteChannel(channelId: string, mutedUntil: string | null) {
    return this.request('PUT', `/channels/${channelId}/mute`, { mutedUntil });
  }
  unmuteChannel(channelId: string) {
    return this.request('DELETE', `/channels/${channelId}/mute`);
  }
  async userByPublicId(publicId: string) {
    return (await this.request<{ user: PublicUser }>('GET', `/users/by-public-id/${encodeURIComponent(publicId)}`)).user;
  }

  // ------------------------------------------------------------ sessions
  mySessions() {
    return this.request<{ setSessions: SetSessionListItem[]; openSessions: SetSessionListItem[] }>('GET', '/me/sessions');
  }
  async createSession(name: string, isSet = false) {
    return (await this.request<{ session: SessionDTO }>('POST', '/sessions', { name, isSet })).session;
  }
  async joinSession(code: string) {
    return (await this.request<{ session: SessionDTO }>('POST', '/sessions/join', { code })).session;
  }
  async updateSession(id: string, input: UpdateSessionInput) {
    return (await this.request<{ session: SessionDTO }>('PATCH', `/sessions/${id}`, input)).session;
  }
  async rotateCode(id: string) {
    return (await this.request<{ session: SessionDTO }>('POST', `/sessions/${id}/rotate-code`)).session;
  }
  deleteSession(id: string) {
    return this.request('DELETE', `/sessions/${id}`);
  }
  forgetSession(id: string) {
    return this.request('DELETE', `/me/sessions/${id}`);
  }
  setNickname(id: string, nickname: string | null) {
    return this.request('PATCH', `/sessions/${id}/members/me`, { nickname });
  }
  addMod(id: string, publicId: string) {
    return this.request('POST', `/sessions/${id}/mods`, { publicId });
  }
  removeMod(id: string, userId: string) {
    return this.request('DELETE', `/sessions/${id}/mods/${userId}`);
  }
  transferOwnership(id: string, publicId: string) {
    return this.request('POST', `/sessions/${id}/transfer`, { publicId });
  }
  kick(id: string, userId: string) {
    return this.request('POST', `/sessions/${id}/kick/${userId}`);
  }
  async sessionBans(id: string) {
    return (await this.request<{ bans: BanDTO[] }>('GET', `/sessions/${id}/bans`)).bans;
  }
  ban(id: string, target: { userId?: string; publicId?: string }, reason?: string) {
    return this.request('POST', `/sessions/${id}/bans`, { ...target, reason });
  }
  unban(id: string, userId: string) {
    return this.request('DELETE', `/sessions/${id}/bans/${userId}`);
  }

  // ------------------------------------------------------------ channels
  async createChannel(sessionId: string, input: CreateChannelInput) {
    return (await this.request<{ channel: ChannelDTO }>('POST', `/sessions/${sessionId}/channels`, input)).channel;
  }
  async updateChannel(id: string, input: UpdateChannelInput) {
    return (await this.request<{ channel: ChannelDTO }>('PATCH', `/channels/${id}`, input)).channel;
  }
  deleteChannel(id: string) {
    return this.request('DELETE', `/channels/${id}`);
  }
  voiceToken(channelId: string) {
    return this.request<VoiceTokenResponse>('POST', `/channels/${channelId}/voice-token`);
  }
  /** Session-wide moderator mute (removes the right to use a microphone). */
  serverMute(sessionId: string, userId: string, muted: boolean) {
    return this.request('POST', `/sessions/${sessionId}/server-mute/${userId}`, { muted });
  }
  channelKick(channelId: string, userId: string) {
    return this.request('POST', `/channels/${channelId}/kick/${userId}`);
  }
  async channelBans(channelId: string) {
    return (await this.request<{ bans: BanDTO[] }>('GET', `/channels/${channelId}/bans`)).bans;
  }
  channelBan(channelId: string, userId: string, reason?: string) {
    return this.request('POST', `/channels/${channelId}/bans/${userId}`, { reason });
  }
  channelUnban(channelId: string, userId: string) {
    return this.request('DELETE', `/channels/${channelId}/bans/${userId}`);
  }

  // ------------------------------------------------------------ messages
  messages(channelId: string, before?: string) {
    const q = before ? `?before=${before}` : '';
    return this.request<{ messages: MessageDTO[]; hasMore: boolean }>('GET', `/channels/${channelId}/messages${q}`);
  }
  async sendMessage(channelId: string, input: SendMessageInput) {
    return (await this.request<{ message: MessageDTO }>('POST', `/channels/${channelId}/messages`, input)).message;
  }
  editMessage(id: string, content: string) {
    return this.request('PATCH', `/messages/${id}`, { content });
  }
  deleteMessage(id: string) {
    return this.request('DELETE', `/messages/${id}`);
  }
  uploadTicket(sessionId: string, input: CreateUploadInput) {
    return this.request<UploadTicket>('POST', `/sessions/${sessionId}/uploads`, input);
  }
}

/** PUTs bytes to a presigned URL with progress (XHR works on web, Electron and React Native). */
export function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'upload_failed', 'Upload failed')));
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Upload failed (network)'));
    xhr.send(body);
  });
}

function summarize(u: AccountSummary): AccountSummary {
  return {
    id: u.id,
    displayName: u.displayName,
    publicId: u.publicId,
    avatarUrl: u.avatarUrl,
    avatarStaticUrl: u.avatarStaticUrl ?? u.avatarUrl,
    isGuest: u.isGuest,
  };
}
