import { AUDIO_PRESETS, type AudioPreset } from '@zirzircord/shared';
import { Hash, Volume2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button, Field, Modal, cx, inputCls } from '../components/ui';
import { closeModal, useApp, zz } from '../lib/zz';

export function ChannelModal({ type: createType, channelId }: { type?: 'TEXT' | 'VOICE'; channelId?: string }) {
  const { sessionId, existing } = useApp((s) => ({
    sessionId: s.activeSessionId!,
    existing: channelId ? s.sessions[s.activeSessionId!]?.channels.find((c) => c.id === channelId) : undefined,
  }));
  const type = existing?.type ?? createType ?? 'TEXT';
  const [name, setName] = useState(existing?.name ?? '');
  const [preset, setPreset] = useState<AudioPreset>(existing?.audioPreset ?? 'HIGH');
  const [limit, setLimit] = useState(existing?.userLimit ?? 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { name: name.trim(), ...(type === 'VOICE' ? { audioPreset: preset, userLimit: limit } : {}) };
    const ok = await zz.attempt(() => (existing ? zz.api.updateChannel(existing.id, input) : zz.api.createChannel(sessionId, { ...input, type })));
    if (ok) {
      if (!existing && type === 'TEXT') zz.setActiveChannel(sessionId, ok.id);
      closeModal();
    }
  };
  const remove = async () => {
    if (!existing || !confirm(`Delete ${existing.name}? Its messages and files are deleted too.`)) return;
    if ((await zz.attempt(() => zz.api.deleteChannel(existing.id))) !== undefined) closeModal();
  };

  return (
    <Modal title={existing ? 'Edit channel' : `Create ${type === 'TEXT' ? 'text' : 'voice'} channel`} onClose={closeModal}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Channel name">
          <div className="flex items-center gap-2 rounded-md bg-rail px-3">
            {type === 'TEXT' ? <Hash size={18} className="text-muted" /> : <Volume2 size={18} className="text-muted" />}
            <input
              className="w-full bg-transparent py-2 text-sm outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              required
              autoFocus
              placeholder={type === 'TEXT' ? 'new-channel' : 'Hangout'}
            />
          </div>
        </Field>
        {type === 'VOICE' && (
          <>
            <Field label="Audio quality" hint="Music mode turns off echo cancellation and noise suppression for full-range stereo.">
              <div className="grid gap-1.5">
                {(Object.keys(AUDIO_PRESETS) as AudioPreset[]).map((k) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setPreset(k)}
                    className={cx('rounded-md border px-3 py-2 text-left text-sm', preset === k ? 'border-brand bg-brand/10' : 'border-line')}
                  >
                    {AUDIO_PRESETS[k].label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={`User limit: ${limit === 0 ? 'No limit' : limit}`}>
              <input type="range" min={0} max={99} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full accent-brand" />
            </Field>
          </>
        )}
        <div className="flex gap-2">
          {existing && (
            <Button type="button" variant="danger" onClick={remove}>
              Delete
            </Button>
          )}
          <Button className="flex-1" disabled={!name.trim()}>
            {existing ? 'Save' : 'Create channel'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
