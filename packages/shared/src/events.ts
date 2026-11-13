import type {
  ChannelDTO,
  MemberDTO,
  MessageDTO,
  ReactionDTO,
  PresenceState,
  PublicUser,
  SessionDTO,
  SessionSnapshot,
} from './types';

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string; message: string }) => void;

/** Events the server pushes to clients. */
export interface ServerToClientEvents {
  'session:updated': (session: SessionDTO) => void;
  /** Temporary session closed (everyone left), deleted by owner, or deleted after sleeping too long. */
  'session:closed': (p: { sessionId: string; reason: 'empty' | 'deleted' | 'expired' }) => void;
  'presence:update': (p: PresenceState) => void;
  'member:upsert': (p: { sessionId: string; member: MemberDTO }) => void;
  'member:removed': (p: { sessionId: string; userId: string }) => void;
  /** Sent to the affected user only. */
  'session:removed': (p: { sessionId: string; reason: 'kicked' | 'banned' }) => void;
  'channel:upsert': (c: ChannelDTO) => void;
  'channel:deleted': (p: { sessionId: string; channelId: string }) => void;
  /** Sent to the affected user only. */
  'channel:removed': (p: { sessionId: string; channelId: string; reason: 'kicked' | 'banned' }) => void;
  'message:new': (m: MessageDTO) => void;
  'message:updated': (m: MessageDTO) => void;
  'message:deleted': (p: { channelId: string; messageId: string }) => void;
  'reaction:update': (p: { channelId: string; messageId: string; reactions: ReactionDTO[] }) => void;
  typing: (p: { channelId: string; userId: string }) => void;
  'voice:state': (p: { sessionId: string; channelId: string; participants: string[] }) => void;
  'user:updated': (u: PublicUser) => void;
  /** A member of this session deleted their account: their messages now show as "Deleted user". */
  'user:deleted': (p: { sessionId: string; userId: string }) => void;
  /** Sent to the affected user only: their account was deleted (e.g. from another device). */
  'account:deleted': (p: { userId: string }) => void;
}

/** Events clients send to the server. */
export interface ClientToServerEvents {
  /** Mark yourself present in a session you are a member of. */
  'session:enter': (sessionId: string, ack: Ack<SessionSnapshot>) => void;
  /** Explicitly leave (log out of) a session. */
  'session:exit': (sessionId: string, ack: Ack<null>) => void;
  typing: (channelId: string) => void;
}
