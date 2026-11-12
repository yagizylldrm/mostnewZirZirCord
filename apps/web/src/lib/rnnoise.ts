import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

let wasm: Promise<ArrayBuffer> | null = null;
const workletLoaded = new WeakSet<BaseAudioContext>();

/**
 * RNNoise (recurrent neural network noise suppression) as a LiveKit audio
 * processor. Removes keyboard clicks, fans, hums etc. before audio is encoded.
 */
export function createRnnoiseProcessor(): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  let source: MediaStreamAudioSourceNode | null = null;
  let node: RnnoiseWorkletNode | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;

  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: 'rnnoise',
    async init({ track, audioContext }) {
      wasm ??= loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath });
      const wasmBinary = await wasm;
      if (!workletLoaded.has(audioContext)) {
        await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
        workletLoaded.add(audioContext);
      }
      if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});
      source = audioContext.createMediaStreamSource(new MediaStream([track]));
      node = new RnnoiseWorkletNode(audioContext, { maxChannels: 1, wasmBinary });
      dest = audioContext.createMediaStreamDestination();
      source.connect(node).connect(dest);
      processor.processedTrack = dest.stream.getAudioTracks()[0];
    },
    async restart(opts) {
      await processor.destroy();
      await processor.init(opts);
    },
    async destroy() {
      source?.disconnect();
      node?.disconnect();
      node?.destroy();
      dest?.disconnect();
      source = node = dest = null;
      processor.processedTrack = undefined;
    },
  };
  return processor;
}
