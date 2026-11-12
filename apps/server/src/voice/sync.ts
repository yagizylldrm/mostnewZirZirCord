import { prisma } from '../lib/db';
import type { SessionHub } from '../sessions/hub';
import { parseRoomName, roomName, roomService } from './livekit';

/**
 * Keeps voice-channel occupancy in sync with LiveKit by polling its API.
 * Works without webhooks (e.g. when the API's public URL changes, as with a
 * temporary tunnel) and repairs anything a missed webhook left behind.
 */
export function startVoiceSync(hub: SessionHub, intervalMs = 5000) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const rooms = await roomService.listRooms();
      const live = new Set<string>();
      for (const room of rooms) {
        const parsed = parseRoomName(room.name);
        if (!parsed) continue;
        live.add(parsed.channelId);
        const ids = room.numParticipants > 0 ? (await roomService.listParticipants(room.name)).map((p) => p.identity) : [];
        await hub.reconcileVoice(parsed.sessionId, parsed.channelId, ids);
      }
      for (const channelId of await hub.occupiedVoiceChannels()) {
        if (live.has(channelId)) continue;
        const ch = await prisma.channel.findUnique({ where: { id: channelId }, select: { sessionId: true } });
        if (ch) await hub.reconcileVoice(ch.sessionId, channelId, []);
        else await hub.reconcileVoice('', channelId, []);
      }
    } catch (err) {
      console.warn('[voice-sync]', (err as Error).message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}

/** Re-checks one room shortly after someone gets a voice token, so the sidebar updates fast. */
export function syncRoomSoon(hub: SessionHub, sessionId: string, channelId: string) {
  for (const delay of [1500, 4000]) {
    setTimeout(async () => {
      try {
        const ps = await roomService.listParticipants(roomName(sessionId, channelId));
        await hub.reconcileVoice(sessionId, channelId, ps.map((p) => p.identity));
      } catch {
        /* room may not exist yet */
      }
    }, delay).unref();
  }
}
