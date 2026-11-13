import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { checkClient, corsOriginAllowed, enforceClientCheck, isAllowedOrigin } from '../lib/client-check';
import { HttpError } from '../lib/errors';
import { assertUserActive, verifyAccessToken } from '../auth/tokens';
import { prisma } from '../lib/db';
import { type IO, rooms, SessionHub } from '../sessions/hub';

function toAckError(err: unknown) {
  if (err instanceof HttpError) return { ok: false as const, error: err.code, message: err.message };
  console.error('[socket] unexpected error', err);
  return { ok: false as const, error: 'internal', message: 'Something went wrong' };
}

/** Per-socket limits: realtime events bypass the HTTP rate limiter. */
const MAX_EVENTS_PER_SECOND = 50;
const ENTER_MAX = 10;
const ENTER_WINDOW_MS = 10_000;
const TYPING_INTERVAL_MS = 2_000;

export function createRealtime(httpServer: HttpServer) {
  const io: IO = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, corsOriginAllowed(origin)), credentials: true },
    // WebSocket upgrades aren't covered by CORS: refuse other websites outright.
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      const bad = !!origin && origin !== 'null' && !isAllowedOrigin(origin);
      if (bad && !enforceClientCheck()) console.warn(`[socket] foreign origin ${origin} (log only)`);
      cb(bad && enforceClientCheck() ? 'bad_origin' : null, !(bad && enforceClientCheck()));
    },
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 64 * 1024,
  });
  const hub = new SessionHub(io);

  io.use(async (socket, next) => {
    try {
      const verdict = checkClient(socket.handshake.headers.origin, socket.handshake.auth?.client);
      if (!verdict.ok) {
        if (enforceClientCheck()) return next(new Error(verdict.code));
        console.warn(`[socket] client check failed: ${verdict.code} (log only)`);
      }
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      const ctx = await verifyAccessToken(token);
      await assertUserActive(ctx.userId);
      socket.data.userId = ctx.userId;
      socket.data.deviceHash = ctx.deviceHash;
      socket.data.sessions = new Set();
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const MAX_SOCKETS_PER_USER = 10;
  io.on('connection', async (socket) => {
    const { userId } = socket.data;
    if ((await io.in(rooms.user(userId)).fetchSockets()).length >= MAX_SOCKETS_PER_USER) {
      socket.disconnect(true);
      return;
    }
    // Simple per-socket token bucket for event flooding.
    let tokens = 20;
    let last = Date.now();
    const allow = () => {
      const now = Date.now();
      tokens = Math.min(20, tokens + ((now - last) / 1000) * 5);
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
    socket.join(rooms.user(userId));

    // Flood guard: a client sending more than MAX_EVENTS_PER_SECOND is cut off.
    let windowStart = Date.now();
    let eventsInWindow = 0;
    socket.use((_packet, next) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        eventsInWindow = 0;
      }
      if (++eventsInWindow > MAX_EVENTS_PER_SECOND) {
        socket.disconnect(true);
        return;
      }
      next();
    });
    const enterTimes: number[] = [];
    const lastTyping = new Map<string, number>();
    prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});

    socket.on('session:enter', async (sessionId, ack) => {
      if (typeof ack !== 'function') return;
      if (!allow()) return ack({ ok: false, error: 'rate_limited', message: 'Slow down' });
      try {
        const now = Date.now();
        while (enterTimes.length && now - enterTimes[0] > ENTER_WINDOW_MS) enterTimes.shift();
        if (enterTimes.length >= ENTER_MAX) throw new HttpError(429, 'rate_limited', 'Too many attempts, slow down');
        enterTimes.push(now);
        if (typeof sessionId !== 'string') throw new HttpError(400, 'bad_request', 'sessionId required');
        ack({ ok: true, data: await hub.enter(sessionId, userId, socket.data.deviceHash, socket.id) });
      } catch (err) {
        ack(toAckError(err));
      }
    });

    socket.on('session:exit', async (sessionId, ack) => {
      try {
        await hub.leave(sessionId, userId);
        ack?.({ ok: true, data: null });
      } catch (err) {
        ack?.(toAckError(err));
      }
    });

    socket.on('typing', (channelId) => {
      if (typeof channelId !== 'string' || !allow()) return;
      const now = Date.now();
      if (now - (lastTyping.get(channelId) ?? 0) < TYPING_INTERVAL_MS) return;
      lastTyping.set(channelId, now);
      if (lastTyping.size > 200) lastTyping.clear();
      const room = rooms.channel(channelId);
      if (socket.rooms.has(room)) socket.to(room).emit('typing', { channelId, userId });
    });

    socket.on('disconnect', async () => {
      // Offline time (guest expiry) counts from the moment the last connection closes.
      const remaining = await io.in(rooms.user(userId)).fetchSockets().catch(() => []);
      if (!remaining.length) prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
      for (const sessionId of socket.data.sessions) {
        hub.socketGone(sessionId, userId, socket.id).catch((e) => console.error('[socket] socketGone', e));
      }
    });
  });

  return { io, hub };
}
