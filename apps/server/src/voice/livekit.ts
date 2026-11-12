import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import { env } from '../env';
import { prisma } from '../lib/db';

const httpUrl = env.LIVEKIT_URL.replace(/^ws/, 'http');
export const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
export const webhookReceiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

export const roomName = (sessionId: string, channelId: string) => `s_${sessionId}_c_${channelId}`;

export function parseRoomName(name: string): { sessionId: string; channelId: string } | null {
  const m = /^s_([0-9a-f-]{36})_c_([0-9a-f-]{36})$/.exec(name);
  return m ? { sessionId: m[1], channelId: m[2] } : null;
}

/** Sources a participant may publish. Server-muted users lose the microphone. */
export function publishSources(micAllowed: boolean) {
  return [
    ...(micAllowed ? [TrackSource.MICROPHONE] : []),
    TrackSource.CAMERA,
    TrackSource.SCREEN_SHARE,
    TrackSource.SCREEN_SHARE_AUDIO,
  ];
}

export async function createVoiceToken(opts: {
  room: string;
  userId: string;
  name: string;
  metadata: Record<string, unknown>;
  micAllowed: boolean;
}) {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: opts.userId,
    name: opts.name,
    metadata: JSON.stringify(opts.metadata),
    // Short-lived: the token is only needed to connect (LiveKit refreshes it for
    // connected participants). A kicked/banned/muted user can't reuse an old one.
    ttl: '10m',
  });
  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
    canPublishSources: publishSources(opts.micAllowed),
  });
  return at.toJwt();
}

/** Best-effort helpers: LiveKit being briefly unavailable must not break moderation. */
export async function kickFromRoom(room: string, userId: string) {
  await roomService.removeParticipant(room, userId).catch(() => {});
}

/** Removes a user from every voice room of a session. */
export async function kickFromSessionVoice(sessionId: string, userId: string) {
  const voice = await prisma.channel.findMany({ where: { sessionId, type: 'VOICE' }, select: { id: true } });
  await Promise.all(voice.map((c) => kickFromRoom(roomName(sessionId, c.id), userId)));
}

export async function deleteRoom(room: string) {
  await roomService.deleteRoom(room).catch(() => {});
}

/**
 * Grants or revokes the right to publish a microphone. Revoking makes LiveKit
 * unpublish the mic and reject any attempt to republish it (push-to-talk included).
 */
export async function setMicAllowed(room: string, userId: string, allowed: boolean) {
  await roomService
    .updateParticipant(room, userId, {
      permission: {
        canSubscribe: true,
        canPublish: true,
        canPublishData: true,
        canPublishSources: publishSources(allowed),
      },
    })
    .catch(() => {
      /* not in this room */
    });
}

export async function serverMuteMic(room: string, userId: string): Promise<boolean> {
  try {
    const p = await roomService.getParticipant(room, userId);
    const mic = p.tracks.find((t) => t.source === TrackSource.MICROPHONE);
    if (!mic) return false;
    await roomService.mutePublishedTrack(room, userId, mic.sid, true);
    return true;
  } catch {
    return false;
  }
}
