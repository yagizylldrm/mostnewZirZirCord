import { type CropView, clampOffset, coverScale, sourceRect, zoomAroundCenter } from '@zirzircord/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** Output sizes match what the server keeps (see apps/server/src/lib/media.ts), at 2x for sharpness. */
const KINDS = {
  avatar: { aspect: 1, out: [512, 512], frame: 288, round: true, title: 'Crop your avatar' },
  banner: { aspect: 960 / 384, out: [1920, 768], frame: 440, round: false, title: 'Crop your banner' },
} as const;

export type CropKind = keyof typeof KINDS;

/**
 * Drag to move, slide to zoom, then "Use this crop" hands back the cropped image.
 * (Animated GIFs skip this: a canvas would flatten them to one frame.)
 */
export function ImageCropper({ file, kind, onCancel, onDone }: { file: File; kind: CropKind; onCancel: () => void; onDone: (blob: Blob) => void }) {
  const k = KINDS[kind];
  const frameW = Math.min(k.frame, typeof window === 'undefined' ? k.frame : window.innerWidth - 48);
  const frameH = Math.round(frameW / k.aspect);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<Pick<CropView, 'zoom' | 'offsetX' | 'offsetY'>>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    // Made and revoked inside the effect: React's dev double-run would otherwise reuse a revoked URL.
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    const el = new Image();
    el.onload = () => {
      // Start centred.
      const base = { frameW, frameH, imgW: el.naturalWidth, imgH: el.naturalHeight };
      const s = coverScale(base);
      setView({ zoom: 1, ...clampOffset({ ...base, zoom: 1, offsetX: (frameW - el.naturalWidth * s) / 2, offsetY: (frameH - el.naturalHeight * s) / 2 }) });
      setImg(el);
    };
    el.onerror = () => setError('That file could not be read as an image.');
    el.src = objectUrl;
    return () => {
      el.onload = el.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, frameW, frameH]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // don't also close the settings dialog underneath
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const full: CropView | null = img ? { frameW, frameH, imgW: img.naturalWidth, imgH: img.naturalHeight, ...view } : null;
  const scale = full ? coverScale(full) * view.zoom : 1;

  const done = () => {
    if (!full || !img) return;
    const { sx, sy, sw, sh } = sourceRect(full);
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = k.out;
    const ctx = canvas.getContext('2d');
    if (!ctx) return setError('Your browser cannot crop images.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => (b ? onDone(b) : setError('Could not crop that image.')), 'image/webp', 0.92);
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-3">
      <div role="dialog" aria-modal="true" aria-label={k.title} className="w-fit max-w-full space-y-4 rounded-xl bg-main p-5 shadow-2xl">
        <h2 className="text-lg font-semibold">{k.title}</h2>
        {error ? (
          <p className="rounded-md bg-danger/15 px-3 py-2 text-sm text-danger">{error}</p>
        ) : (
          <>
            <div
              className="relative touch-none overflow-hidden bg-black select-none"
              style={{ width: frameW, height: frameH, cursor: drag.current ? 'grabbing' : 'grab', borderRadius: k.round ? '50%' : 12 }}
              onPointerDown={(e) => {
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY };
              }}
              onPointerMove={(e) => {
                if (!drag.current || !full) return;
                const next = { ...full, offsetX: drag.current.ox + e.clientX - drag.current.x, offsetY: drag.current.oy + e.clientY - drag.current.y };
                setView({ zoom: view.zoom, ...clampOffset(next) });
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              {img && url && (
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute max-w-none"
                  style={{ left: view.offsetX, top: view.offsetY, width: img.naturalWidth * scale, height: img.naturalHeight * scale }}
                />
              )}
            </div>
            <label className="block text-xs text-muted">
              Zoom
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={view.zoom}
                disabled={!full}
                onChange={(e) => full && setView(zoomAroundCenter({ ...full, ...view }, Number(e.target.value)))}
                className="mt-1 w-full accent-brand"
              />
            </label>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {!error && (
            <Button type="button" onClick={done} disabled={!img}>
              Use this crop
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
