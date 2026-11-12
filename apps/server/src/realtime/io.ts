import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { HttpError } from '../lib/errors';
import { verifyAccessToken } from '../auth/tokens';
import { prisma } from '../lib/db';
import { type IO, rooms, SessionHub } from '../sessions/hub';

function toAckError(err: unknown) {
  if (err instanceof HttpError) return { ok: false as const, error: err.code, message: err.message };
  console.error('[socket] unexpected error', err);
  return { ok: false as const, error: 'internal', message: 'Something went wrong' };
}

export function createRealtime(httpServer: HttpServer, originAllowed: (origin: string | undefined) => boolean) {
  const io: IO = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)), credentials: true },
    pingInterval: 10_000,
    pingTimeout: 15_000,
    maxHttpBufferSize: 64 * 1024,
  });
  const hub = new SessionHub(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      const ctx = await verifyAccessToken(token);
      socket.data.userId = ctx.userId;
      socket.data.deviceHash = ctx.deviceHash;
      socket.data.sessions = new Set();
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    socket.join(rooms.user(userId));
    prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});

    socket.on('session:enter', async (sessionId, ack) => {
      if (typeof ack !== 'function') return;
      try {
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
      if (typeof channelId !== 'string') return;
      const room = rooms.channel(channelId);
      if (socket.rooms.has(room)) socket.to(room).emit('typing', { channelId, userId });
    });

    socket.on('disconnect', () => {
      for (const sessionId of socket.data.sessions) {
        hub.socketGone(sessionId, userId, socket.id).catch((e) => console.error('[socket] socketGone', e));
      }
    });
  });

  return { io, hub };
}
