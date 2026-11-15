import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gifSearchSchema } from '@zirzircord/shared';
import { searchGifs, trendingGifs } from '../lib/giphy';
import { hitGifSearchLimit } from '../lib/spam';
import { requireMember } from '../sessions/access';

const sid = z.object({ id: z.string().uuid() });

/** GIF search for a session (its owner decides the highest rating). Limited per user (see lib/spam.ts). */
export async function gifRoutes(app: FastifyInstance) {
  const opts = { preHandler: app.authenticate };

  app.get('/sessions/:id/gifs/trending', opts, async (req) => {
    const { id } = sid.parse(req.params);
    const { offset } = gifSearchSchema.parse(req.query);
    const m = await requireMember(id, req.auth.userId);
    await hitGifSearchLimit(req.auth.userId);
    return trendingGifs(offset, m.session.gifRating);
  });

  app.get('/sessions/:id/gifs/search', opts, async (req) => {
    const { id } = sid.parse(req.params);
    const { q, offset } = gifSearchSchema.parse(req.query);
    const m = await requireMember(id, req.auth.userId);
    await hitGifSearchLimit(req.auth.userId);
    return searchGifs(q ?? '', offset, m.session.gifRating);
  });
}
