import 'fastify';
import type { AuthContext } from '../auth/tokens';
import type { IO, SessionHub } from '../sessions/hub';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
    hub: SessionHub;
    io: IO;
  }
  interface FastifyRequest {
    auth: AuthContext;
  }
}
