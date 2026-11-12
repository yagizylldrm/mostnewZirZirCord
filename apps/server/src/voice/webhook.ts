import type { FastifyInstance } from 'fastify';
import { parseRoomName, webhookReceiver } from './livekit';

/** LiveKit tells us who joins/leaves voice rooms → we broadcast voice occupancy. */
export async function voiceWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post('/webhooks/livekit', async (req, reply) => {
    let event;
    try {
      event = await webhookReceiver.receive(req.body as string, req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'unauthorized', message: 'Bad webhook signature' });
    }
    const parsed = event.room?.name ? parseRoomName(event.room.name) : null;
    if (!parsed) return { ok: true };
    const { sessionId, channelId } = parsed;
    const identity = event.participant?.identity;
    switch (event.event) {
      case 'participant_joined':
        if (identity) await app.hub.setVoiceParticipant(sessionId, channelId, identity, true);
        break;
      case 'participant_left':
        if (identity) await app.hub.setVoiceParticipant(sessionId, channelId, identity, false);
        break;
      case 'room_finished':
        await app.hub.clearVoiceChannel(sessionId, channelId);
        break;
    }
    return { ok: true };
  });
}
