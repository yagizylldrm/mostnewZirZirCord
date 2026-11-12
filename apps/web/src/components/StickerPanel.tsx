import { PROFILE_IMAGE_MAX_BYTES } from '@zirzircord/shared';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp, zz } from '../lib/zz';

/** WhatsApp-style sticker drawer: your collection, tap to send, make new ones from any image/GIF. */
export function StickerPanel({ onSend, onClose }: { onSend: (stickerId: string) => void; onClose: () => void }) {
  const stickers = useApp((s) => s.stickers);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    zz.loadStickers().catch((e) => zz.notify(e.message, 'error'));
  }, []);

  const create = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return zz.notify('Stickers can be PNG, JPG, WebP or GIF', 'error');
    if (f.size > PROFILE_IMAGE_MAX_BYTES) return zz.notify('Images can be at most 10 MB', 'error');
    setBusy(true);
    if (await zz.attempt(() => zz.createSticker(f, f.type))) zz.notify('Sticker created', 'success');
    setBusy(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 bottom-full z-40 mb-2 w-[min(360px,calc(100vw-32px))] rounded-xl bg-elev p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold tracking-wide text-muted uppercase">Your stickers</span>
          <span className="text-[11px] text-faint">Right-click to delete</span>
        </div>
        <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto">
          <button
            onClick={() => file.current?.click()}
            disabled={busy}
            className="grid aspect-square place-items-center rounded-lg border-2 border-dashed border-line text-muted hover:border-brand hover:text-brand"
            title="Create a sticker from an image or GIF"
          >
            {busy ? <span className="text-xs">…</span> : <Plus />}
          </button>
          {stickers?.map((st) => (
            <button
              key={st.id}
              onClick={() => (onSend(st.id), onClose())}
              onContextMenu={(e) => {
                e.preventDefault();
                if (confirm('Delete this sticker from your collection?')) zz.attempt(() => zz.deleteSticker(st.id));
              }}
              className="aspect-square rounded-lg p-1 hover:bg-hover"
              title="Send sticker"
            >
              <img src={st.url} alt="sticker" className="size-full object-contain" loading="lazy" />
            </button>
          ))}
        </div>
        {stickers?.length === 0 && (
          <p className="mt-2 text-xs text-muted">No stickers yet. Make one from any picture or GIF, or save stickers people send you.</p>
        )}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => (create(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
    </>
  );
}
