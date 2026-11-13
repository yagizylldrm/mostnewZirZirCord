import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  PresenceEntry,
  PresenceState,
  ServerToClientEvents,
  SessionSnapshot,
} from '@zirzircord/shared';
import { env } from '../env';
import { prisma } from '../lib/db';
import { forbidden, notFound } from '../lib/errors';
import { redis, withLock } from '../lib/redis';
import { toChannelDTO, toMemberDTO, toSessionDTO } from '../lib/serializers';
import { deleteKeys, deletePrefix } from '../lib/storage';
import { deleteRoom, roomName } from '../voice/livekit';
import { clearAccessCache, isSessionBanned } from './access';

export interface SocketData {
  userId: string;
  deviceHash: string;
  /** Sessions this socket has entered. */
  sessions: Set<string>;
}
export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Redis keys */
const K = {
  presence: (sid: string) => `pres:${sid}`, // ZSET userId -> since(ms)
  conns: (sid: string, uid: string) => `conns:${sid}:${uid}`, // SET socketIds
  host: (sid: string) => `host:${sid}`,
  voice: (cid: string) => `voice:${cid}`, // SET userIds in a voice channel
};

type CloseReason = 'empty' | 'deleted' | 'expired';

export const rooms = {
  session: (sid: string) => `s:${sid}`,
  channel: (cid: string) => `c:${cid}`,
  user: (uid: string) => `u:${uid}`,
};

/**
 * Owns live session state: who is present, who is host, and when a session
 * closes (temporary) or goes dormant (set session).
 *
 * Host = present member with the oldest `since` timestamp. It is purely a label.
 */
export class SessionHub {
  private timers = new Map<string, NodeJS.Timeout>();
  private graceMs = env.PRESENCE_GRACE_SECONDS * 1000;

  constructor(private io: IO) {}

  // ---------------------------------------------------------------- presence

  async getPresence(sessionId: string): Promise<PresenceState> {
    const raw = await redis.zrange(K.presence(sessionId), 0, -1, 'WITHSCORES');
    const present: PresenceEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) present.push({ userId: raw[i], since: Number(raw[i + 1]) });
    return { sessionId, present, hostId: present[0]?.userId ?? null };
  }

  async isPresent(sessionId: string, userId: string) {
    return (await redis.zscore(K.presence(sessionId), userId)) !== null;
  }

  private async broadcastPresence(sessionId: string) {
    const p = await this.getPresence(sessionId);
    await redis.set(K.host(sessionId), p.hostId ?? '');
    this.io.to(rooms.session(sessionId)).emit('presence:update', p);
    return p;
  }

  async getVoiceState(channelIds: string[]): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    await Promise.all(channelIds.map(async (cid) => (out[cid] = await redis.smembers(K.voice(cid)))));
    return out;
  }

  async setVoiceParticipant(sessionId: string, channelId: string, userId: string, joined: boolean) {
    if (joined) await redis.sadd(K.voice(channelId), userId);
    else await redis.srem(K.voice(channelId), userId);
    const participants = await redis.smembers(K.voice(channelId));
    this.io.to(rooms.session(sessionId)).emit('voice:state', { sessionId, channelId, participants });
  }

  /** Replaces a voice channel's occupant list with what LiveKit reports (no-op if unchanged). */
  async reconcileVoice(sessionId: string, channelId: string, identities: string[]) {
    const current = (await redis.smembers(K.voice(channelId))).sort();
    const next = [...new Set(identities)].sort();
    if (current.length === next.length && current.every((v, i) => v === next[i])) return;
    const multi = redis.multi().del(K.voice(channelId));
    if (next.length) multi.sadd(K.voice(channelId), ...next);
    await multi.exec();
    this.io.to(rooms.session(sessionId)).emit('voice:state', { sessionId, channelId, participants: next });
  }

  /** Channel ids that currently have recorded voice occupants. */
  async occupiedVoiceChannels(): Promise<string[]> {
    return (await scanKeys('voice:*')).map((k) => k.slice('voice:'.length));
  }

  async clearVoiceChannel(sessionId: string, channelId: string) {
    await redis.del(K.voice(channelId));
    this.io.to(rooms.session(sessionId)).emit('voice:state', { sessionId, channelId, participants: [] });
  }

  // ------------------------------------------------------------- enter/leave

  /** A socket marks its user present in a session. Returns the full snapshot. */
  async enter(sessionId: string, userId: string, deviceHash: string, socketId: string): Promise<SessionSnapshot> {
    return withLock(`sess:${sessionId}`, async () => {
      const member = await prisma.sessionMember.findUnique({
        where: { sessionId_userId: { sessionId, userId } },
        include: { session: true },
      });
      if (!member) throw notFound('Session');
      if (await isSessionBanned(sessionId, userId, deviceHash)) throw forbidden('You are banned from this session', 'banned');

      let session = member.session;
      if (session.state === 'DORMANT' || session.sleepingSince) {
        clearAccessCache();
        // Reopening (or waking) a set session: the opener becomes the first present member → host.
        session = await prisma.session.update({
          where: { id: sessionId },
          data: { state: 'ACTIVE', sleepingSince: null, lastActiveAt: new Date() },
        });
        this.io.to(rooms.session(sessionId)).emit('session:updated', toSessionDTO(session));
      } else if (Date.now() - session.lastActiveAt.getTime() > 60 * 60 * 1000) {
        await prisma.session.update({ where: { id: sessionId }, data: { lastActiveAt: new Date() } });
      }

      this.cancelTimer(`${sessionId}:${userId}`);
      this.cancelTimer(`${sessionId}:__empty`);
      await redis.sadd(K.conns(sessionId, userId), socketId);
      const added = await redis.zadd(K.presence(sessionId), 'NX', Date.now(), userId);
      await prisma.sessionMember.update({
        where: { sessionId_userId: { sessionId, userId } },
        data: { lastVisitedAt: new Date() },
      });

      // Join socket rooms: session + every text/voice channel the user isn't banned from.
      const [channels, bans, members, mutes] = await Promise.all([
        prisma.channel.findMany({ where: { sessionId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
        prisma.channelBan.findMany({ where: { userId, channel: { sessionId } }, select: { channelId: true } }),
        prisma.sessionMember.findMany({ where: { sessionId }, include: { user: true } }),
        prisma.channelMute.findMany({ where: { userId, channel: { sessionId } } }),
      ]);
      const banned = new Set(bans.map((b) => b.channelId));
      const visible = channels.filter((c) => !banned.has(c.id));
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join([rooms.session(sessionId), ...visible.map((c) => rooms.channel(c.id))]);
        socket.data.sessions.add(sessionId);
      }

      const presence = added ? await this.broadcastPresence(sessionId) : await this.getPresence(sessionId);
      if (added) {
        const me = members.find((m) => m.userId === userId);
        if (me) this.io.to(rooms.session(sessionId)).emit('member:upsert', { sessionId, member: toMemberDTO(me) });
      }

      return {
        session: toSessionDTO(session),
        myRole: member.role,
        members: members.map(toMemberDTO),
        channels: visible.map(toChannelDTO),
        presence,
        voice: await this.getVoiceState(visible.filter((c) => c.type === 'VOICE').map((c) => c.id)),
        notify: { level: member.notifyLevel, mutedUntil: member.mutedUntil?.toISOString() ?? null },
        channelMutes: Object.fromEntries(mutes.map((m) => [m.channelId, m.mutedUntil?.toISOString() ?? null])),
      };
    });
  }

  /** A socket that had entered the session disconnected. Starts the grace timer if it was the user's last one. */
  async socketGone(sessionId: string, userId: string, socketId: string) {
    await redis.srem(K.conns(sessionId, userId), socketId);
    const remaining = await redis.scard(K.conns(sessionId, userId));
    if (remaining === 0 && (await this.isPresent(sessionId, userId))) {
      this.schedule(`${sessionId}:${userId}`, this.graceMs, async () => {
        if ((await redis.scard(K.conns(sessionId, userId))) === 0) await this.leave(sessionId, userId);
      });
    }
  }

  /**
   * Removes a user's presence from a session (explicit leave, grace expiry, kick, ban).
   * Recomputes the host and closes/sleeps the session if it is now empty.
   */
  async leave(sessionId: string, userId: string) {
    this.cancelTimer(`${sessionId}:${userId}`);
    await withLock(`sess:${sessionId}`, async () => {
      await redis.del(K.conns(sessionId, userId));
      await redis.zrem(K.presence(sessionId), userId);
      await this.detachUserSockets(sessionId, userId);
      const p = await this.broadcastPresence(sessionId);
      if (p.present.length === 0) await this.closeOrSleep(sessionId, 'empty');
    });
  }

  /** Makes every socket of a user leave a session's rooms. */
  async detachUserSockets(sessionId: string, userId: string) {
    const channels = await prisma.channel.findMany({ where: { sessionId }, select: { id: true } });
    const roomList = [rooms.session(sessionId), ...channels.map((c) => rooms.channel(c.id))];
    const sockets = await this.io.in(rooms.user(userId)).fetchSockets();
    for (const s of sockets) {
      s.leave(rooms.session(sessionId));
      for (const r of roomList) s.leave(r);
      s.data.sessions?.delete(sessionId);
    }
  }

  /**
   * After REST create/join the client should `session:enter` quickly. If nobody
   * ever becomes present, the session must not live forever.
   */
  scheduleEmptyCheck(sessionId: string) {
    this.schedule(`${sessionId}:__empty`, this.graceMs + 5_000, async () => {
      await withLock(`sess:${sessionId}`, async () => {
        const count = await redis.zcard(K.presence(sessionId));
        if (count === 0) await this.closeOrSleep(sessionId, 'empty');
      });
    });
  }

  // ------------------------------------------------------------- lifecycle

  /** Must be called while holding the session lock. */
  private async closeOrSleep(sessionId: string, reason: CloseReason) {
    clearAccessCache();
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return;
    if (session.isSet && reason === 'empty') {
      if (session.state !== 'DORMANT') {
        const s = await prisma.session.update({ where: { id: sessionId }, data: { state: 'DORMANT' } });
        this.io.to(rooms.session(sessionId)).emit('session:updated', toSessionDTO(s));
      }
      return;
    }
    await this.destroy(sessionId, reason);
  }

  /** Deletes a session and everything it owns: messages, files, voice rooms, presence. */
  private async destroy(sessionId: string, reason: CloseReason) {
    const [channels, attachments] = await Promise.all([
      prisma.channel.findMany({ where: { sessionId } }),
      prisma.attachment.findMany({ where: { sessionId }, select: { storageKey: true, thumbnailKey: true } }),
    ]);
    // Tell clients first, then remove them from rooms.
    this.io.to(rooms.session(sessionId)).emit('session:closed', { sessionId, reason });
    const roomList = [rooms.session(sessionId), ...channels.map((c) => rooms.channel(c.id))];
    this.io.in(roomList).socketsLeave(roomList);

    await prisma.session.delete({ where: { id: sessionId } }); // cascades members, channels, messages, bans, attachments

    const pipeline = redis.pipeline();
    pipeline.del(K.presence(sessionId), K.host(sessionId));
    for (const c of channels) pipeline.del(K.voice(c.id));
    await pipeline.exec();
    const connKeys = await scanKeys(`conns:${sessionId}:*`);
    if (connKeys.length) await redis.del(...connKeys);

    await Promise.all(channels.filter((c) => c.type === 'VOICE').map((c) => deleteRoom(roomName(sessionId, c.id))));
    const keys = attachments.flatMap((a) => [a.storageKey, a.thumbnailKey].filter(Boolean) as string[]);
    await deleteKeys(keys).catch(() => {});
    await deletePrefix(`sessions/${sessionId}/`).catch(() => {});
  }

  /** Owner deletes the session outright (also for set sessions), or it expired after sleeping too long. */
  async deleteSession(sessionId: string, reason: 'deleted' | 'expired' = 'deleted') {
    await withLock(`sess:${sessionId}`, () => this.destroy(sessionId, reason));
  }

  // ---------------------------------------------------------------- recovery

  /**
   * On boot, sockets from before the restart are gone. Give every previously
   * present user one grace period to reconnect, and check sessions with nobody.
   */
  async recover() {
    const connKeys = await scanKeys('conns:*');
    if (connKeys.length) await redis.del(...connKeys);
    const presenceKeys = await scanKeys('pres:*');
    for (const key of presenceKeys) {
      const sessionId = key.slice('pres:'.length);
      for (const userId of await redis.zrange(key, 0, -1)) {
        this.schedule(`${sessionId}:${userId}`, this.graceMs, async () => {
          if ((await redis.scard(K.conns(sessionId, userId))) === 0) await this.leave(sessionId, userId);
        });
      }
    }
    const active = await prisma.session.findMany({ where: { state: 'ACTIVE' }, select: { id: true } });
    for (const s of active) {
      if (!presenceKeys.includes(K.presence(s.id))) this.scheduleEmptyCheck(s.id);
    }
  }

  // ---------------------------------------------------------------- timers

  private schedule(key: string, ms: number, fn: () => Promise<void>) {
    this.cancelTimer(key);
    const t = setTimeout(() => {
      this.timers.delete(key);
      fn().catch((err) => console.error(`[hub] timer ${key} failed`, err));
    }, ms);
    t.unref?.();
    this.timers.set(key, t);
  }

  private cancelTimer(key: string) {
    const t = this.timers.get(key);
    if (t) {
      clearTimeout(t);
      this.timers.delete(key);
    }
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}


/** Non-blocking replacement for KEYS (which stalls Redis while it walks the whole keyspace). */
async function scanKeys(match: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
    out.push(...batch);
    cursor = next;
  } while (cursor !== '0');
  return [...new Set(out)];
}
