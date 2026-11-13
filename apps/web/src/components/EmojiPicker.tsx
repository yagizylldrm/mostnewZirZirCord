import 'emoji-picker-element';
import dataSource from 'emoji-picker-element-data/en/emojibase/data.json?url';
import { useEffect, useRef } from 'react';
import { cx } from './ui';

/** Full emoji picker (web component). Emoji data is bundled locally — no CDN. */
export function EmojiPicker({ onPick, onClose, below }: { onPick: (emoji: string) => void; onClose: () => void; below?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.createElement('emoji-picker') as HTMLElement & { dataSource: string };
    el.dataSource = dataSource;
    el.classList.add('dark');
    el.style.setProperty('--num-columns', '9');
    el.style.setProperty('--background', 'var(--color-elev)');
    el.style.setProperty('--border-color', 'transparent');
    el.style.setProperty('--indicator-color', 'var(--color-brand)');
    el.style.setProperty('--input-border-color', 'var(--color-line)');
    el.style.width = 'min(360px, calc(100vw - 32px))';
    el.style.height = '360px';
    const onClick = (e: Event) => onPick((e as CustomEvent<{ unicode: string }>).detail.unicode);
    el.addEventListener('emoji-click', onClick);
    host.current?.appendChild(el);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('emoji-click', onClick);
      el.remove();
      window.removeEventListener('keydown', onKey);
    };
  }, [onPick, onClose]);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div ref={host} className={cx('absolute right-0 z-40 overflow-hidden rounded-xl shadow-2xl', below ? 'top-full mt-2' : 'bottom-full mb-2')} />
    </>
  );
}
