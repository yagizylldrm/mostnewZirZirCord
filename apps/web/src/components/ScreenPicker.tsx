import { useEffect, useState } from 'react';
import { desktop, type ScreenSource } from '../lib/desktop';
import { Button, Modal, Toggle, cx } from './ui';

/** Electron only: lets the user choose which screen/window to share. */
export function ScreenPicker() {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [audio, setAudio] = useState(true);
  const [tab, setTab] = useState<'screens' | 'windows'>('screens');

  useEffect(
    () =>
      desktop?.onScreenPickerRequest((s) => {
        setSources(s);
        setSelected(s.find((x) => x.isScreen)?.id ?? s[0]?.id ?? null);
        setTab('screens');
      }),
    [],
  );
  if (!sources) return null;
  const finish = (id: string | null) => {
    desktop?.chooseScreenSource(id, audio);
    setSources(null);
  };
  const list = sources.filter((s) => (tab === 'screens' ? s.isScreen : !s.isScreen));

  return (
    <Modal
      title="Share your screen"
      wide
      onClose={() => finish(null)}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-sm">
            <Toggle checked={audio} onChange={setAudio} /> Share sound
          </label>
          <Button variant="ghost" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button disabled={!selected} onClick={() => finish(selected)}>
            Go live
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        {(['screens', 'windows'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-md px-3 py-1.5 text-sm', tab === t ? 'bg-field' : 'text-muted')}>
            {t === 'screens' ? 'Screens' : 'Applications'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            onDoubleClick={() => finish(s.id)}
            className={cx('overflow-hidden rounded-lg border-2 bg-rail text-left', selected === s.id ? 'border-brand' : 'border-transparent')}
          >
            <img src={s.thumbnail} alt="" className="aspect-video w-full object-contain" />
            <div className="flex items-center gap-1.5 p-2 text-xs">
              {s.appIcon && <img src={s.appIcon} alt="" className="size-4" />}
              <span className="truncate">{s.name}</span>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
