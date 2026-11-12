import { LIMITS, canMentionEveryone, mentionToken } from '@zirzircord/shared';
import { listedMembers, memberName, type OutgoingFile } from '@zirzircord/client-core';
import type { MessageDTO } from '@zirzircord/shared';
import { FileText, Mic, PlusCircle, Send, Smile, Square, Sticker, Trash2, X } from 'lucide-react';
import { type ClipboardEvent, type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, formatDuration } from '../lib/format';
import { VoiceRecorder, fileToOutgoing } from '../lib/media';
import { useApp, zz } from '../lib/zz';
import { EmojiPicker } from './EmojiPicker';
import { StickerPanel } from './StickerPanel';
import { Avatar, IconButton, cx } from './ui';

export function Composer(p: { sessionId: string; channelId: string; channelName: string; replyTo: MessageDTO | null; onClearReply: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<OutgoingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rec, setRec] = useState<{ r: VoiceRecorder; elapsed: number; level: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { view, allUploads, typing, meId } = useApp((s) => ({
    view: s.sessions[p.sessionId],
    allUploads: s.uploads,
    typing: s.typing[p.channelId],
    meId: s.me!.id,
  }));
  const uploads = allUploads.filter((u) => u.channelId === p.channelId);
  const [panel, setPanel] = useState<'emoji' | 'stickers' | null>(null);
  // @mention autocomplete: names typed as "@Name" are turned into <@id> tokens when sending.
  const mentionMap = useRef(new Map<string, string>());
  const [suggest, setSuggest] = useState<{ query: string; index: number } | null>(null);
  const mayEveryone = !!view && canMentionEveryone(view.myRole, view.session);
  const suggestions = useMemo(() => {
    if (!suggest || !view) return [];
    const q = suggest.query.toLowerCase();
    const people = listedMembers(view)
      .filter((m) => m.user.id !== meId)
      .map((m) => ({ id: m.user.id, name: memberName(view, m.user.id), user: m.user }))
      .filter((m) => m.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
      .slice(0, 8);
    const all = mayEveryone && 'everyone'.startsWith(q) ? [{ id: 'everyone', name: 'everyone', user: null }] : [];
    return [...all, ...people];
  }, [suggest, view, meId, mayEveryone]);

  // Caret position to restore right after React commits the new text (before the next keystroke).
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = input.current;
    if (el && pendingCaret.current !== null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);
  const insertAtCaret = useCallback((insert: string, replaceBefore = 0) => {
    const el = input.current;
    const pos = el?.selectionStart ?? text.length;
    pendingCaret.current = pos - replaceBefore + insert.length;
    setText(text.slice(0, pos - replaceBefore) + insert + text.slice(pos));
  }, [text]);

  const pickSuggestion = (i: number) => {
    const s = suggestions[i];
    if (!s || !suggest) return;
    if (s.id !== 'everyone') mentionMap.current.set(s.name, s.id);
    insertAtCaret(`@${s.name} `, suggest.query.length + 1);
    setSuggest(null);
  };

  const updateSuggest = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,32})$/.exec(value.slice(0, caret));
    setSuggest(m ? { query: m[2], index: 0 } : null);
  };

  /** "@Name" (chosen from autocomplete) → <@id> */
  const toTokens = (value: string) => {
    let out = value;
    for (const [name, id] of [...mentionMap.current].sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(`@${name}`).join(mentionToken(id));
    }
    return out;
  };
  const onEmoji = useCallback((emoji: string) => insertAtCaret(emoji), [insertAtCaret]);
  const closePanel = useCallback(() => setPanel(null), []);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => input.current?.focus(), [p.channelId, p.replyTo]);

  const typers = Object.entries(typing ?? {})
    .filter(([uid, exp]) => exp > Date.now() && uid !== meId)
    .map(([uid]) => memberName(view, uid));

  const addFiles = async (list: FileList | File[]) => {
    const arr = await Promise.all(Array.from(list).map(fileToOutgoing));
    setFiles((f) => [...f, ...arr].slice(0, LIMITS.attachmentsPerMessage));
  };

  const send = async (extra: OutgoingFile[] = []) => {
    const content = toTokens(text.trim());
    const all = [...files, ...extra];
    if (!content && all.length === 0) return;
    setSending(true);
    const reply = p.replyTo?.id;
    setText('');
    setFiles([]);
    p.onClearReply();
    // Shows instantly; if it fails, the message gets Retry / Delete buttons in the chat.
    await zz.sendMessage(p.sessionId, p.channelId, content, all, reply);
    setSending(false);
  };

  const startRecording = async () => {
    if (!VoiceRecorder.supported()) return zz.notify('Voice messages are not supported in this browser', 'error');
    const r = new VoiceRecorder();
    r.onLevel = (level, elapsed) => {
      setRec((cur) => (cur ? { ...cur, level, elapsed } : cur));
      if (elapsed > LIMITS.voiceMessageMaxSeconds * 1000) stopRecording(r);
    };
    try {
      await r.start();
      setRec({ r, elapsed: 0, level: 0 });
    } catch {
      zz.notify('Microphone permission denied', 'error');
    }
  };
  const stopRecording = async (r = rec?.r) => {
    if (!r) return;
    setRec(null);
    const out = await r.stop();
    if (out) await send([out]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };

  return (
    <div
      className="relative shrink-0 px-4 pb-4 safe-bottom"
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="absolute inset-x-4 -top-24 bottom-4 z-10 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-main/90 text-brand">
          Drop files to upload to #{p.channelName}
        </div>
      )}
      {uploads.map((u) => (
        <div key={u.id} className="mb-2 rounded-md bg-side px-3 py-2 text-xs">
          <div className="mb-1 flex justify-between">
            <span className="truncate">Uploading {u.filename}</span>
            <span>{Math.round(u.progress * 100)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded bg-line">
            <div className="h-full bg-brand transition-all" style={{ width: `${u.progress * 100}%` }} />
          </div>
        </div>
      ))}
      {suggest && suggestions.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-lg bg-elev py-1 shadow-xl">
          <div className="px-3 py-1 text-[11px] font-bold tracking-wide text-muted uppercase">Mention</div>
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              onMouseDown={(e) => (e.preventDefault(), pickSuggestion(i))}
              className={cx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === suggest.index ? 'bg-hover text-fg' : 'text-muted')}
            >
              {s.user ? <Avatar name={s.name} url={s.user.avatarUrl} staticUrl={s.user.avatarStaticUrl} size={22} /> : <span className="grid size-[22px] place-items-center rounded-full bg-brand text-xs text-white">@</span>}
              <span className="text-fg">{s.name}</span>
              {s.id === 'everyone' && <span className="text-xs">notify everyone in this session</span>}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-lg bg-field">
        {p.replyTo && (
          <div className="flex items-center justify-between rounded-t-lg bg-side px-3 py-1.5 text-xs text-muted">
            <span>
              Replying to <b className="text-fg">{memberName(view, p.replyTo.authorId)}</b>
            </span>
            <button onClick={p.onClearReply} aria-label="Cancel reply">
              <X size={14} />
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="flex gap-2 overflow-x-auto p-3">
            {files.map((f, i) => (
              <div key={i} className="relative w-36 shrink-0 rounded-md bg-side p-2">
                {f.kind === 'IMAGE' ? (
                  <img src={URL.createObjectURL(f.blob)} className="h-24 w-full rounded object-cover" alt="" />
                ) : (
                  <div className="grid h-24 place-items-center">
                    <FileText size={36} className="text-brand" />
                  </div>
                )}
                <div className="mt-1 truncate text-xs">{f.filename}</div>
                <div className="text-[10px] text-muted">{formatBytes(f.blob.size)}</div>
                <button
                  onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 rounded bg-black/60 p-1 text-danger"
                  aria-label="Remove file"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {rec ? (
          <div className="flex items-center gap-3 px-3 py-2.5">
            <span className="size-2.5 rounded-full bg-danger pulse-dot" />
            <span className="font-mono text-sm">{formatDuration(rec.elapsed)}</span>
            <div className="h-2 flex-1 overflow-hidden rounded bg-line">
              <div className="h-full bg-danger transition-all duration-75" style={{ width: `${Math.round(rec.level * 100)}%` }} />
            </div>
            <IconButton label="Cancel recording" onClick={() => (rec.r.cancel(), setRec(null))}>
              <X size={18} />
            </IconButton>
            <IconButton label="Send voice message" onClick={() => stopRecording()} className="bg-brand text-white hover:bg-brand">
              <Square size={14} />
            </IconButton>
          </div>
        ) : (
          <div className="flex items-end gap-1 px-2 py-1.5">
            <IconButton label="Attach files" onClick={() => picker.current?.click()}>
              <PlusCircle size={20} />
            </IconButton>
            <input ref={picker} type="file" multiple hidden onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ''))} />
            <textarea
              ref={input}
              value={text}
              rows={1}
              maxLength={LIMITS.message}
              placeholder={`Message #${p.channelName}`}
              onPaste={onPaste}
              onChange={(e) => {
                setText(e.target.value);
                updateSuggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
                zz.sendTyping(p.channelId);
              }}
              onKeyDown={(e) => {
                if (suggest && suggestions.length) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const d = e.key === 'ArrowDown' ? 1 : -1;
                    setSuggest({ ...suggest, index: (suggest.index + d + suggestions.length) % suggestions.length });
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    pickSuggestion(suggest.index);
                    return;
                  }
                  if (e.key === 'Escape') return setSuggest(null);
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              className="max-h-48 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-faint"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = `${Math.min(192, t.scrollHeight)}px`;
              }}
            />
            <div className="relative flex">
              <IconButton label="Stickers" onClick={() => setPanel(panel === 'stickers' ? null : 'stickers')} active={panel === 'stickers'}>
                <Sticker size={20} />
              </IconButton>
              <IconButton label="Emoji" onClick={() => setPanel(panel === 'emoji' ? null : 'emoji')} active={panel === 'emoji'}>
                <Smile size={20} />
              </IconButton>
              {panel === 'emoji' && <EmojiPicker onPick={onEmoji} onClose={closePanel} />}
              {panel === 'stickers' && (
                <StickerPanel onClose={closePanel} onSend={(id) => zz.attempt(() => zz.sendSticker(p.sessionId, p.channelId, id))} />
              )}
            </div>
            {text.trim() || files.length ? (
              <IconButton label="Send" onClick={() => send()} className="text-brand">
                <Send size={18} />
              </IconButton>
            ) : (
              <IconButton label="Record voice message" onClick={startRecording}>
                <Mic size={20} />
              </IconButton>
            )}
          </div>
        )}
      </div>
      <div className={cx('h-5 pt-1 text-xs text-muted', !typers.length && 'invisible')}>
        <b>{typers.slice(0, 3).join(', ')}</b> {typers.length > 1 ? 'are' : 'is'} typing…
      </div>
    </div>
  );
}
