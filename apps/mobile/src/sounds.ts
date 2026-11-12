import { type SoundEvent, SoundManager } from '@zirzircord/client-core';
import { type AudioPlayer, createAudioPlayer } from 'expo-audio';
import { storage } from './storage';

const FILES: Record<SoundEvent, number> = {
  join: require('../assets/sounds/join.wav'),
  leave: require('../assets/sounds/leave.wav'),
  connect: require('../assets/sounds/connect.wav'),
  disconnect: require('../assets/sounds/disconnect.wav'),
  message: require('../assets/sounds/message.wav'),
  mention: require('../assets/sounds/mention.wav'),
  mute: require('../assets/sounds/mute.wav'),
  unmute: require('../assets/sounds/unmute.wav'),
  deafen: require('../assets/sounds/deafen.wav'),
  undeafen: require('../assets/sounds/undeafen.wav'),
};
const players = new Map<SoundEvent, AudioPlayer>();

function player(event: SoundEvent, volume: number) {
  let p = players.get(event);
  if (!p) {
    p = createAudioPlayer(FILES[event]);
    players.set(event, p);
  }
  p.volume = volume;
  p.seekTo(0);
  p.play();
}

let dnd = () => false;
export const sounds = new SoundManager(storage, player, () => dnd());
export function setDndCheck(fn: () => boolean) {
  dnd = fn;
}
