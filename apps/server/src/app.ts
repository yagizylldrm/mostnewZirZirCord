import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { authRoutes } from './auth/routes';
import { verifyAccessToken } from './auth/tokens';
import { channelRoutes } from './channels/routes';
import { env } from './env';
import { HttpError, unauthorized } from './lib/errors';
import { clearAccessCache } from './sessions/access';
import { messageRoutes } from './messages/routes';
import { createRealtime } from './realtime/io';
import { sessionRoutes } from './sessions/routes';
import { stickerRoutes } from './stickers/routes';
import { uploadRoutes } from './uploads/routes';
import { userRoutes } from './users/routes';
import { voiceWebhookRoutes } from './voice/webhook';

export async function buildApp(opts: { logger?: boolean } = {}) {
  // Exact origins, or patterns like https://*.vercel.app (for preview deployments).
  const corsPatterns = env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`));
  // Desktop (Electron file://) and mobile apps send no/opaque origins.
  const originAllowed = (origin: string | undefined) => !origin || origin === 'null' || corsPatterns.some((re) => re.test(origin));
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 1024 * 1024 });

  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  const { io, hub } = createRealtime(app.server, originAllowed);
  app.decorate('io', io);
  app.decorate('hub', hub);
  app.decorateRequest('auth', null as any);
  app.decorate('authenticate', async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    req.auth = await verifyAccessToken(header.slice(7));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: 'validation', message: `${first?.path.join('.') || 'input'}: ${first?.message}` });
    }
    const status = (err as any).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: (err as any).code ?? 'internal', message: status >= 500 ? 'Internal server error' : (err as Error).message });
  });

  // Permission checks are briefly cached (see sessions/access.ts). Any state-changing
  // request other than chat traffic may change who can do what, so clear it.
  app.addHook('onResponse', async (req) => {
    if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') return;
    const route = req.routeOptions.url ?? '';
    if (route === '/channels/:id/messages' || route === '/messages/:id' || route.startsWith('/auth/') || route === '/channels/:id/voice-token') return;
    clearAccessCache();
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(sessionRoutes);
  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(uploadRoutes);
  await app.register(stickerRoutes);
  await app.register(voiceWebhookRoutes);

  app.addHook('onClose', async () => {
    hub.stop();
    io.close();
  });
  return app;
}
