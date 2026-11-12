import { Download, X } from 'lucide-react';
import { ui, useUi } from '../lib/zz';

export function Lightbox() {
  const url = useUi((u) => u.lightbox);
  if (!url) return null;
  const close = () => ui.setState({ lightbox: null });
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/90 p-4" onClick={close}>
      <img src={url} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      <div className="absolute top-3 right-3 flex gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={(e) => e.stopPropagation()}>
          <Download size={20} />
        </a>
        <button className="rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={close} aria-label="Close">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
