import { guessKind, type OutgoingFile } from '@zirzircord/client-core';

/** Turns a picked/dropped/pasted File into an upload with useful metadata. */
export async function fileToOutgoing(file: File): Promise<OutgoingFile> {
  const mime = file.type || 'application/octet-stream';
  const kind = guessKind(mime);
  const out: OutgoingFile = { blob: file, filename: file.name || `file-${Date.now()}`, mime, kind };
  try {
    if (kind === 'IMAGE' && mime !== 'image/svg+xml') {
      const bmp = await createImageBitmap(file);
      out.width = bmp.width;
      out.height = bmp.height;
      bmp.close();
    } else if (kind === 'VIDEO' || kind === 'AUDIO') {
      const meta = await mediaMetadata(file, kind === 'VIDEO' ? 'video' : 'audio');
      Object.assign(out, meta);
    }
  } catch {
    /* metadata is optional */
  }
  return out;
}

function mediaMetadata(file: Blob, tag: 'video' | 'audio'): Promise<{ durationMs?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const el = document.createElement(tag);
    const url = URL.createObjectURL(file);
    const done = (v: { durationMs?: number; width?: number; height?: number }) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () =>
      done({
        durationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined,
        width: tag === 'video' ? (el as HTMLVideoElement).videoWidth || undefined : undefined,
        height: tag === 'video' ? (el as HTMLVideoElement).videoHeight || undefined : undefined,
      });
    el.onerror = () => done({});
    el.src = url;
  });
}

/**
 * Records a voice message with MediaRecorder (Opus/WebM, or AAC/MP4 on Safari)
 * and samples the input level to build a waveform for playback.
 */
export class VoiceRecorder {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private ctx?: AudioContext;
  private chunks: Blob[] = [];
  private peaks: number[] = [];
  private timer?: number;
  private startedAt = 0;
  onLevel?: (level: number, elapsedMs: number) => void;

  static supported() {
    return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: 64_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    this.startedAt = performance.now();
    this.timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      const level = Math.min(1, peak / 100);
      this.peaks.push(level);
      this.onLevel?.(level, performance.now() - this.startedAt);
    }, 50);
    this.recorder.start(250);
  }

  async stop(): Promise<OutgoingFile | null> {
    const rec = this.recorder;
    if (!rec) return null;
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.stop();
    await stopped;
    const durationMs = Math.round(performance.now() - this.startedAt);
    this.cleanup();
    const mime = (rec.mimeType || 'audio/webm').split(';')[0];
    const blob = new Blob(this.chunks, { type: mime });
    if (durationMs < 500 || blob.size === 0) return null;
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    return {
      blob,
      filename: `voice-message-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`,
      mime,
      kind: 'VOICE_MESSAGE',
      durationMs,
      waveform: downsample(this.peaks, 64).map((v) => Math.round(v * 255)),
    };
  }

  cancel() {
    this.recorder?.stop();
    this.cleanup();
  }

  private cleanup() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.recorder = undefined;
  }
}

function downsample(values: number[], n: number): number[] {
  if (values.length === 0) return new Array(n).fill(0);
  const out: number[] = [];
  const step = values.length / n;
  for (let i = 0; i < n; i++) {
    const slice = values.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
    out.push(Math.max(...slice));
  }
  return out;
}
