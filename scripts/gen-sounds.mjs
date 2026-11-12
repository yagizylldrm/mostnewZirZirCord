// Generates ZirZirCord's UI sound effects as small WAV files (original, synthesized).
//   node scripts/gen-sounds.mjs
// Output: apps/web/public/sounds/*.wav and apps/mobile/assets/sounds/*.wav
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const root = fileURLToPath(new URL('..', import.meta.url));

/** A soft bell-like note: fundamental + quieter harmonics, fast attack, exponential decay. */
function note(buf, start, freq, dur, gain = 0.5, { decay = 6, glide = 0, harmonics = [1, 0.35, 0.12] } = {}) {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  let phase = harmonics.map(() => 0);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const f = freq * (1 + glide * (t / dur));
    const attack = Math.min(1, t / 0.006);
    const env = attack * Math.exp(-decay * t);
    let v = 0;
    harmonics.forEach((h, k) => {
      phase[k] += (2 * Math.PI * f * (k + 1)) / RATE;
      v += h * Math.sin(phase[k]);
    });
    buf[s0 + i] += gain * env * v;
  }
}

function render(length, build) {
  const buf = new Float32Array(Math.floor(length * RATE));
  build(buf);
  // normalise to -3 dBFS and fade the tail to avoid clicks
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const k = peak ? 0.7 / peak : 1;
  const fade = Math.floor(0.02 * RATE);
  for (let i = 0; i < buf.length; i++) {
    buf[i] *= k;
    if (i > buf.length - fade) buf[i] *= (buf.length - i) / fade;
  }
  return buf;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5, G4 = 392, C4 = 261.63, E4 = 329.63;

const SOUNDS = {
  // someone joins / leaves your voice channel
  join: render(0.45, (b) => (note(b, 0, E5, 0.3, 0.5), note(b, 0.09, A5, 0.36, 0.55))),
  leave: render(0.45, (b) => (note(b, 0, A5, 0.3, 0.5), note(b, 0.09, E5, 0.36, 0.5))),
  // you connect / disconnect
  connect: render(0.6, (b) => (note(b, 0, C5, 0.3, 0.45), note(b, 0.08, E5, 0.3, 0.45), note(b, 0.16, G5, 0.44, 0.55))),
  disconnect: render(0.6, (b) => (note(b, 0, G5, 0.3, 0.45), note(b, 0.08, E5, 0.3, 0.45), note(b, 0.16, C5, 0.44, 0.5))),
  // new message: soft pop; mention: bright double ping
  message: render(0.25, (b) => note(b, 0, C6, 0.22, 0.5, { decay: 18, glide: -0.12, harmonics: [1, 0.2] })),
  mention: render(0.5, (b) => (note(b, 0, E6, 0.25, 0.45, { decay: 9 }), note(b, 0.11, C6 * 1.5, 0.38, 0.5, { decay: 8 }))),
  // your own mic / headphone toggles
  mute: render(0.18, (b) => note(b, 0, G4, 0.16, 0.6, { decay: 22, glide: -0.2, harmonics: [1, 0.3] })),
  unmute: render(0.18, (b) => note(b, 0, C5, 0.16, 0.6, { decay: 22, glide: 0.2, harmonics: [1, 0.3] })),
  deafen: render(0.28, (b) => (note(b, 0, E4, 0.14, 0.55, { decay: 20 }), note(b, 0.08, C4, 0.2, 0.55, { decay: 18 }))),
  undeafen: render(0.28, (b) => (note(b, 0, C4, 0.14, 0.55, { decay: 20 }), note(b, 0.08, E4 * 1.5, 0.2, 0.55, { decay: 18 }))),
};

for (const dir of ['apps/web/public/sounds', 'apps/mobile/assets/sounds']) {
  mkdirSync(root + dir, { recursive: true });
  for (const [name, samples] of Object.entries(SOUNDS)) writeFileSync(`${root}${dir}/${name}.wav`, wav(samples));
}
console.log('sounds written:', Object.keys(SOUNDS).join(', '));
