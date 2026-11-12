import type { AttachmentKind, AudioPreset, ChannelType, NotifyLevel, Role, SessionState, UserStatus } from './constants';

/** What everyone else can see about a user. Never contains email or IP. */
export interface PublicUser {
  id: string;
  publicId: string;
  displayName: string;
  /** Animated (if the avatar is a GIF) — show only on hover / while speaking / in profile cards. */
  avatarUrl: string | null;
  /** First frame of the avatar (same as avatarUrl for still images). */
  avatarStaticUrl: string | null;
  bannerUrl: string | null;
  bannerStaticUrl: string | null;
  bio: string;
  bannerColor: string;
  status: UserStatus;
  isGuest: boolean;
}

/** The signed-in user's own profile (includes private fields). */
export interface SelfUser extends PublicUser {
  email: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: SelfUser;
}

export interface SessionSettings {
  membersCanCreateText: boolean;
  membersCanCreateVoice: boolean;
  accountsOnly: boolean;
  membersCanMentionEveryone: boolean;
}

export interface SessionDTO extends SessionSettings {
  id: string;
  name: string;
  /** Raw 8-char code; display with formatSessionCode(). */
  code: string;
  ownerId: string;
  isSet: boolean;
  state: SessionState;
  createdAt: string;
}

export interface MemberDTO {
  user: PublicUser;
  role: Role;
  nickname: string | null;
  firstVisitedAt: string;
  /** Muted by a moderator: cannot publish a microphone anywhere in the session. */
  serverMuted: boolean;
}

export interface PresenceEntry {
  userId: string;
  /** ms epoch when this stint of presence started — used for host order. */
  since: number;
}

export interface PresenceState {
  sessionId: string;
  present: PresenceEntry[];
  hostId: string | null;
}

export interface ChannelDTO {
  id: string;
  sessionId: string;
  type: ChannelType;
  name: string;
  position: number;
  createdById: string | null;
  audioPreset: AudioPreset;
  userLimit: number;
}

export interface AttachmentDTO {
  id: string;
  kind: AttachmentKind;
  filename: string;
  mime: string;
  size: number;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
}

export interface MessageDTO {
  id: string;
  channelId: string;
  /** Null when the author deleted their account ("Deleted user"). */
  authorId: string | null;
  content: string;
  replyToId: string | null;
  /** User ids mentioned with <@id> tokens. */
  mentions: string[];
  mentionsEveryone: boolean;
  /** Echo of the sender's client nonce (only on the realtime/POST response of a new message). */
  nonce?: string;
  attachments: AttachmentDTO[];
  createdAt: string;
  editedAt: string | null;
}

export interface BanDTO {
  user: PublicUser;
  reason: string | null;
  bannedById: string;
  createdAt: string;
}

/** Full snapshot sent when a user enters a session. */
export interface SessionSnapshot {
  session: SessionDTO;
  myRole: Role;
  members: MemberDTO[];
  channels: ChannelDTO[];
  presence: PresenceState;
  voice: Record<string, string[]>;
  notify: NotifySettings;
  /** channelId -> muted until (ISO, null = indefinitely) */
  channelMutes: Record<string, string | null>;
}

export interface NotifySettings {
  level: NotifyLevel;
  /** ISO date; null = not muted. */
  mutedUntil: string | null;
}

export interface StickerDTO {
  id: string;
  url: string;
  staticUrl: string | null;
  width: number;
  height: number;
  animated: boolean;
}

export interface SetSessionListItem {
  session: SessionDTO;
  live: boolean;
  presentCount: number;
  lastVisitedAt: string;
}

export interface UploadTicket {
  attachmentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export interface VoiceTokenResponse {
  url: string;
  token: string;
  room: string;
  audioPreset: AudioPreset;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
