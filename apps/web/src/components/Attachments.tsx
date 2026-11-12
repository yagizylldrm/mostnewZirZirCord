import type { AttachmentDTO } from '@zirzircord/shared';
import { BookmarkPlus, Download, FileText, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatDuration } from '../lib/format';
import { ui, zz } from '../lib/zz';
import { cx } from './ui';

export function AttachmentView({ a }: { a: AttachmentDTO }) {
  switch (a.kind) {
    case 'IMAGE': {
      const w = a.width ?? 400;
      const h = a.height ?? 300;
      const scale = Math.min(1, 400 / w, 320 / h);
      return (
        <button onClick={() => ui.setState({ lightbox: a.url })} className="block overflow-hidden rounded-lg bg-rail" style={{ maxWidth: '100%' }}>
          <img
            src={a.thumbnailUrl ?? a.url}
            alt={a.filename}
            loading="lazy"
            className="block max-w-full object-contain"
            style={{ width: Math.round(w * scale), aspectRatio: `${w} / ${h}` }}
          />
        </button>
      );
    }
    case 'VIDEO':
      return <video src={a.url} controls preload="metadata" playsInline className="max-h-80 max-w-full rounded-lg bg-black" />;
    case 'STICKER':
      return <StickerView a={a} />;
    case 'VOICE_MESSAGE':
      return <VoiceMessagePlayer a={a} />;
    case 'AUDIO':
      return (
        <div className="w-full max-w-md space-y-2 rounded-lg bg-side p-3">
          <FileLine a={a} />
          <audio src={a.url} controls preload="metadata" className="w-full" />
        </div>
      );
    default:
      return (
        <div className="w-full max-w-md rounded-lg bg-side p-3">
          <FileLine a={a} />
        </div>
      );
  }
}

function FileLine({ a }: { a: AttachmentDTO }) {
  return (
    <div className="flex items-center gap-3">
      <FileText className="shrink-0 text-brand" size={32} />
      <div className="min-w-0 flex-1">
        <a href={a.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-brand hover:underline">
          {a.filename}
        </a>
        <div className="text-xs text-muted">{formatBytes(a.size)}</div>
      </div>
      <a href={a.url} download={a.filename} target="_blank" rel="noreferrer" title="Download" className="text-muted hover:text-fg">
        <Download size={20} />
      </a>
    </div>
  );
}

export function VoiceMessagePlayer({ a }: { a: AttachmentDTO }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(a.durationMs ?? 0);
  const bars = a.waveform?.length ? a.waveform : new Array(48).fill(60);

  useEffect(() => {
    const el = audio.current!;
    const onTime = () => setProgress(el.duration && Number.isFinite(el.duration) ? el.currentTime / el.duration : el.currentTime / ((a.durationMs ?? 1) / 1000));
    const onMeta = () => Number.isFinite(el.duration) && setDuration(el.duration * 1000);
    const onEnd = () => (setPlaying(false), setProgress(0));
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('pause', () => setPlaying(false));
    el.addEventListener('play', () => setPlaying(true));
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, [a.durationMs]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audio.current!;
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    const d = Number.isFinite(el.duration) ? el.duration : duration / 1000;
    el.currentTime = f * d;
    setProgress(f);
  };

  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-full bg-side py-2 pr-4 pl-2">
      <audio ref={audio} src={a.url} preload="metadata" />
      <button
        onClick={() => (playing ? audio.current!.pause() : audio.current!.play())}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex h-8 flex-1 cursor-pointer items-center gap-[2px]" onClick={seek}>
        {bars.map((v, i) => (
          <span
            key={i}
            className={cx('w-full rounded-full', i / bars.length < progress ? 'bg-brand' : 'bg-muted/50')}
            style={{ height: `${Math.max(12, (v / 255) * 100)}%` }}
          />
        ))}
      </div>
      <span className="w-10 text-right font-mono text-xs text-muted">{formatDuration(playing || progress ? duration * progress : duration)}</span>
    </div>
  );
}

/** Stickers: big, transparent, no card. Animated ones play; hover offers "Save sticker". */
function StickerView({ a }: { a: AttachmentDTO }) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="group/sticker relative w-fit">
      <img src={a.url} alt="sticker" className="size-40 object-contain" draggable={false} loading="lazy" />
      <button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          if (await zz.attempt(() => zz.saveSticker(a.id))) zz.notify('Sticker saved to your collection', 'success');
          setSaving(false);
        }}
        className="absolute top-1 right-1 flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-xs opacity-0 group-hover/sticker:opacity-100 max-md:opacity-80"
      >
        <BookmarkPlus size={13} /> {saving ? 'Saving…' : 'Save sticker'}
      </button>
    </div>
  );
}
