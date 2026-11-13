import { createStore } from 'zustand/vanilla';
import { SLEEP } from '@zirzircord/shared';
import type { AccountSummary } from './api';
import type {
  ChannelDTO,
  MemberDTO,
  MessageDTO,
  NotifySettings,
  PresenceState,
  Role,
  SelfUser,
  SessionDTO,
  SetSessionListItem,
  StickerDTO,
} from '@zirzircord/shared';

export interface SessionView {
  session: SessionDTO;
  myRole: Role;
  members: Record<string, MemberDTO>;
  channels: ChannelDTO[];
  presence: PresenceState;
  voice: Record<string, string[]>;
}

/** A message as shown in the UI: server messages plus the sender's own optimistic ones. */
export interface LocalMessage extends MessageDTO {
  /** Shown immediately, waiting for the server. */
  pending?: boolean;
  /** Sending failed — the UI offers Retry / Delete. */
  failed?: boolean;
  /** Files being uploaded with an optimistic message (shown as placeholders). */
  localFiles?: { filename: string; kind: string }[];
}

export interface ChannelMessages {
  items: LocalMessage[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
}

export interface Notice {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface PendingUpload {
  id: string;
  channelId: string;
  filename: string;
  progress: number;
}

export interface AppState {
  ready: boolean;
  me: SelfUser | null;
  connected: boolean;
  /** Sessions the user is currently inside (present). */
  sessions: Record<string, SessionView>;
  sidebar: { setSessions: SetSessionListItem[]; openSessions: SetSessionListItem[] };
  activeSessionId: string | null;
  /** sessionId -> currently shown channel id */
  activeChannel: Record<string, string>;
  messages: Record<string, ChannelMessages>;
  /** channelId -> userId -> expiry ms */
  typing: Record<string, Record<string, number>>;
  uploads: PendingUpload[];
  notices: Notice[];
  /** Accounts saved on this device (active first). */
  accounts: AccountSummary[];
  /** True while the auth screen is shown to add another account. */
  addingAccount: boolean;
  /** channelId -> unread counters */
  unread: Record<string, { count: number; mentions: number }>;
  /** sessionId -> my notification settings */
  notify: Record<string, NotifySettings>;
  /** sessionId -> channelId -> muted until (ISO, null = indefinitely) */
  channelMutes: Record<string, Record<string, string | null>>;
  stickers: StickerDTO[] | null;
}

export const createAppStore = () =>
  createStore<AppState>(() => ({
    ready: false,
    me: null,
    connected: false,
    sessions: {},
    sidebar: { setSessions: [], openSessions: [] },
    activeSessionId: null,
    activeChannel: {},
    messages: {},
    typing: {},
    uploads: [],
    notices: [],
    accounts: [],
    addingAccount: false,
    unread: {},
    notify: {},
    channelMutes: {},
    stickers: null,
  }));

export type AppStore = ReturnType<typeof createAppStore>;

/** Display name of a member in a session (nickname wins). */
/** Display name in a session. A null id is a message whose author deleted their account. */
export function memberName(view: SessionView | undefined, userId: string | null): string {
  if (!userId) return 'Deleted user';
  const m = view?.members[userId];
  return m?.nickname || m?.user.displayName || 'Unknown';
}

/**
 * Members to show in lists, pickers and settings. Closed guest accounts stay in
 * `view.members` only so their old messages keep a name (see memberName).
 */
export function listedMembers(view: SessionView) {
  return Object.values(view.members).filter((m) => !m.user.isDeleted);
}

export function sortChannels(channels: ChannelDTO[]) {
  return [...channels].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** A mute is active when it has no end date, or the end date is in the future. */
export function muteActive(until: string | null | undefined, present = true): boolean {
  if (!present) return false;
  return until === null || (!!until && new Date(until).getTime() > Date.now());
}

export function isSessionMuted(s: AppState, sessionId: string) {
  return muteActive(s.notify[sessionId]?.mutedUntil, !!s.notify[sessionId]?.mutedUntil);
}

export function isChannelMuted(s: AppState, sessionId: string, channelId: string) {
  const m = s.channelMutes[sessionId];
  return !!m && channelId in m && muteActive(m[channelId]);
}

/** Unread totals for a session badge. Muted sessions/channels don't show badges. */
export function sessionUnread(s: AppState, sessionId: string) {
  const view = s.sessions[sessionId];
  let count = 0;
  let mentions = 0;
  if (isSessionMuted(s, sessionId)) return { count, mentions };
  for (const c of view?.channels ?? []) {
    const u = s.unread[c.id];
    if (!u || isChannelMuted(s, sessionId, c.id)) continue;
    mentions += u.mentions;
    count += u.count;
  }
  return { count, mentions };
}

/** Replaces <@id> tokens with @Name for previews and notifications. */
export function mentionsToText(content: string, view: SessionView | undefined) {
  return content.replace(/<@([0-9a-f-]{36})>/g, (_, id) => `@${memberName(view, id)}`);
}

/** For a sleeping set session: whole days left before it is deleted (null when awake). */
export function sleepDaysLeft(session: Pick<SessionDTO, 'sleepingSince'>, now = Date.now()): number | null {
  if (!session.sleepingSince) return null;
  const deletesAt = new Date(session.sleepingSince).getTime() + SLEEP.deleteAfterDays * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((deletesAt - now) / (24 * 60 * 60 * 1000)));
}

/** Short status line for a sleeping session ("💤 Sleeping · deleted in 5 days unless someone opens it"). */
export function sleepLabel(session: Pick<SessionDTO, 'sleepingSince'>, now = Date.now()): { text: string; urgent: boolean } | null {
  const days = sleepDaysLeft(session, now);
  if (days === null) return null;
  const urgent = days <= SLEEP.warnDays;
  const when = days <= 1 ? 'within a day' : `in ${days} days`;
  return { text: urgent ? `💤 Sleeping · deleted ${when} unless someone opens it` : '💤 Sleeping · open it to wake it up', urgent };
}
