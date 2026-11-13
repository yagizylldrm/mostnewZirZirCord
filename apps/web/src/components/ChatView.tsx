import { QUICK_REACTIONS, can, isJumboEmoji, splitMentions } from '@zirzircord/shared';
import { type LocalMessage, memberName, mentionsToText } from '@zirzircord/client-core';
import type { MessageDTO } from '@zirzircord/shared';
import { Clock, Hash, Pencil, Reply, SmilePlus, Trash2, Users } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDay, formatTime } from '../lib/format';
import { ui, useApp, zz } from '../lib/zz';
import { AttachmentView } from './Attachments';
import { Composer } from './Composer';
import { EmojiPicker } from './EmojiPicker';
import { Avatar, IconButton, cx } from './ui';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="text-sky-400 hover:underline">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** Message text with links, @mention pills and @everyone. */
function RichText({ text, sessionId }: { text: string; sessionId: string }) {
  const view = useApp((s) => s.sessions[sessionId]);
  return (
    <>
      {splitMentions(text).map((part, i) =>
        part.type === 'text' ? (
          <Linkified key={i} text={part.text} />
        ) : (
          <button
            key={i}
            className="rounded bg-brand/20 px-1 font-medium text-brand hover:bg-brand/30"
            onClick={(e) =>
              part.type === 'user' &&
              ui.setState({
                profile: {
                  userId: part.userId,
                  sessionId,
                  x: e.clientX,
                  y: e.clientY,
                },
              })
            }
          >
            @{part.type === 'everyone' ? 'everyone' : memberName(view, part.userId)}
          </button>
        ),
      )}
    </>
  );
}

/** For editing: tokens → "@Name"; on save, names of mentioned members → tokens again. */
function tokensToNames(content: string, view: Parameters<typeof memberName>[0]) {
  return mentionsToText(content, view);
}
function namesToTokens(text: string, ids: string[], view: Parameters<typeof memberName>[0]) {
  let out = text;
  for (const id of ids) out = out.split(`@${memberName(view, id)}`).join(`<@${id}>`);
  return out;
}

export function ChatView() {
  const { sessionId, channelId, channel } = useApp((s) => {
    const sid = s.activeSessionId!;
    const cid = s.activeChannel[sid];
    return {
      sessionId: sid,
      channelId: cid,
      channel: s.sessions[sid]?.channels.find((c) => c.id === cid),
    };
  });
  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);

  useEffect(() => {
    if (channelId) zz.loadMessages(channelId).catch((e) => zz.notify(e.message, 'error'));
    setReplyTo(null);
  }, [channelId]);

  // Tell the client what's on screen (for unread counts and notifications).
  useEffect(() => {
    const report = () => zz.setViewing(channelId ?? null, document.visibilityState === 'visible' && document.hasFocus());
    report();
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      document.removeEventListener('visibilitychange', report);
      zz.setViewing(null, false);
    };
  }, [channelId]);

  if (!channel) {
    return <div className="grid flex-1 place-items-center text-muted">No text channel selected</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/30 px-4 max-md:hidden">
        <Hash size={20} className="text-muted" />
        <span className="font-semibold">{channel.name}</span>
        <div className="flex-1" />
        <IconButton label="Toggle member list" onClick={() => ui.setState((u) => ({ membersOpen: !u.membersOpen }))}>
          <Users size={18} />
        </IconButton>
      </header>
      <MessageList sessionId={sessionId} channelId={channel.id} onReply={setReplyTo} />
      <ComposerOrTimeout sessionId={sessionId}>
        <Composer sessionId={sessionId} channelId={channel.id} channelName={channel.name} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      </ComposerOrTimeout>
    </div>
  );
}

function MessageList({ sessionId, channelId, onReply }: { sessionId: string; channelId: string; onReply: (m: MessageDTO) => void }) {
  const { cm, view, meId } = useApp((s) => ({
    cm: s.messages[channelId],
    view: s.sessions[sessionId],
    meId: s.me!.id,
  }));
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | undefined>(undefined);
  const items = cm?.items ?? [];

  // Keep pinned to bottom for new messages; preserve position when older ones load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevFirst.current && items[0]?.id !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = el.scrollHeight;
    prevFirst.current = items[0]?.id;
  }, [items]);

  // Images load after layout; keep the view pinned when they do.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [items.length]);

  const onScroll = () => {
    const el = scroller.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200 && cm?.hasMore && !cm.loading) zz.loadOlder(channelId).catch(() => {});
  };

  const canDeleteAny = can(view?.myRole, 'message.deleteAny');

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end pb-4">
        {cm?.loading && <div className="py-3 text-center text-xs text-muted">Loading…</div>}
        {cm?.loaded && !cm.hasMore && (
          <div className="px-4 pt-8 pb-4">
            <div className="grid size-16 place-items-center rounded-full bg-field">
              <Hash size={36} />
            </div>
            <h3 className="mt-3 text-2xl font-bold">Welcome to #{view?.channels.find((c) => c.id === channelId)?.name}</h3>
            <p className="text-sm text-muted">This is the start of the channel.</p>
          </div>
        )}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped =
            !newDay &&
            prev &&
            prev.authorId === m.authorId &&
            !m.replyToId &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-3 px-4 text-xs font-semibold text-muted">
                  <span className="h-px flex-1 bg-line" />
                  {formatDay(m.createdAt)}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              <MessageRow
                m={m}
                grouped={!!grouped}
                sessionId={sessionId}
                replyTo={m.replyToId ? items.find((x) => x.id === m.replyToId) : undefined}
                canDelete={m.authorId === meId || canDeleteAny}
                canEdit={m.authorId === meId}
                onReply={() => onReply(m)}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function MessageRow(p: {
  m: LocalMessage;
  grouped: boolean;
  sessionId: string;
  replyTo?: MessageDTO;
  canDelete: boolean;
  canEdit: boolean;
  onReply: () => void;
}) {
  const view = useApp((s) => s.sessions[p.sessionId]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.m.content);
  const authorId = p.m.authorId;
  const author = authorId ? view?.members[authorId] : undefined;
  const name = memberName(view, authorId);
  const roleColor = !authorId ? 'text-muted italic' : author?.role === 'OWNER' ? 'text-owner' : author?.role === 'MOD' ? 'text-mod' : 'text-fg';
  // Deleted users have no profile to open.
  const openProfile = (e: React.MouseEvent) =>
    authorId &&
    ui.setState({
      profile: {
        userId: authorId,
        sessionId: p.sessionId,
        x: e.clientX,
        y: e.clientY,
      },
    });

  const me = useApp((s) => s.me!.id);
  const mentionsMe = p.m.mentions.includes(me) || p.m.mentionsEveryone;
  const timedOut = isTimedOut(view?.members[me]?.timeoutUntil);
  const canReact = !p.m.pending && !timedOut;
  const [picker, setPicker] = useState<null | { below: boolean }>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const react = (emoji: string) => void zz.toggleReaction(p.m.channelId, p.m.id, emoji);
  // Open the full picker upwards, unless the message is near the top of the window.
  const openPicker = () =>
    setPicker({
      below: (rowRef.current?.getBoundingClientRect().top ?? 999) < 420,
    });
  const pick = useCallback(
    (emoji: string) => {
      setPicker(null);
      void zz.toggleReaction(p.m.channelId, p.m.id, emoji);
    },
    [p.m.channelId, p.m.id],
  );
  const closePicker = useCallback(() => setPicker(null), []);
  const saveEdit = async () => {
    setEditing(false);
    const next = namesToTokens(draft.trim(), p.m.mentions, view);
    if (next && next !== p.m.content) await zz.attempt(() => zz.api.editMessage(p.m.id, next));
  };

  return (
    <div
      ref={rowRef}
      className={cx(
        'group relative flex gap-4 px-4 hover:bg-black/10',
        p.grouped ? 'py-0.5' : 'mt-3 pt-1 pb-0.5',
        mentionsMe && 'border-l-2 border-brand bg-brand/[0.07] hover:bg-brand/10',
        p.m.pending && !p.m.failed && 'opacity-60',
      )}
    >
      <div className="w-10 shrink-0">
        {!p.grouped && (
          <button onClick={openProfile}>
            <Avatar name={name} url={author?.user.avatarUrl} staticUrl={author?.user.avatarStaticUrl} size={40} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {p.m.replyToId && (
          <div className="mb-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
            <Reply size={12} className="shrink-0 -scale-x-100" />
            <span className="font-semibold">{p.replyTo ? memberName(view, p.replyTo.authorId) : 'Unknown'}</span>
            <span className="truncate">{p.replyTo ? p.replyTo.content || '📎 Attachment' : 'Original message not loaded'}</span>
          </div>
        )}
        {!p.grouped && (
          <div className="flex items-baseline gap-2">
            <button onClick={openProfile} className={cx('font-semibold hover:underline', roleColor)}>
              {name}
            </button>
            <span className="text-xs text-faint">{formatTime(p.m.createdAt)}</span>
          </div>
        )}
        {editing ? (
          <div className="py-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), saveEdit());
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-full resize-none rounded-md bg-field px-3 py-2 text-[15px] outline-none"
              rows={Math.min(8, draft.split('\n').length)}
            />
            <div className="text-xs text-muted">Enter to save · Esc to cancel</div>
          </div>
        ) : (
          p.m.content && (
            <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
              {isJumboEmoji(p.m.content) ? (
                <span className="text-5xl leading-tight">{p.m.content}</span>
              ) : (
                <RichText text={p.m.content} sessionId={p.sessionId} />
              )}
              {p.m.editedAt && <span className="ml-1 text-[10px] text-faint">(edited)</span>}
            </div>
          )
        )}
        {p.m.attachments.length > 0 && (
          <div className="mt-1 flex flex-col items-start gap-2">
            {p.m.attachments.map((a) => (
              <AttachmentView key={a.id} a={a} />
            ))}
          </div>
        )}
        {!!p.m.localFiles?.length && (
          <div className="mt-1 flex flex-wrap gap-2">
            {p.m.localFiles.map((f, i) => (
              <span key={i} className="rounded-md bg-side px-2.5 py-1.5 text-xs text-muted">
                {f.kind === 'VOICE_MESSAGE' ? '🎙️ Voice message' : `📎 ${f.filename}`}
              </span>
            ))}
          </div>
        )}
        {!!p.m.reactions?.length && <Reactions m={p.m} sessionId={p.sessionId} me={me} disabled={!canReact} onToggle={react} onMore={openPicker} />}
        {p.m.pending && !p.m.failed && <div className="text-[11px] text-faint">Sending…</div>}
        {p.m.failed && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-danger">
            <span>Couldn’t send.</span>
            <button className="font-semibold underline hover:no-underline" onClick={() => zz.retrySend(p.m.channelId, p.m.nonce!)}>
              Retry
            </button>
            <button className="text-muted underline hover:no-underline" onClick={() => zz.discardFailed(p.m.channelId, p.m.nonce!)}>
              Delete
            </button>
          </div>
        )}
      </div>
      <div
        className={cx(
          'absolute -top-3 right-4 items-center rounded-md border border-line bg-side shadow',
          picker ? 'flex' : 'hidden',
          !p.m.pending && 'group-hover:flex',
        )}
      >
        {canReact && (
          <>
            {QUICK_REACTIONS.slice(0, 3).map((e) => (
              <button
                key={e}
                title={`React with ${e}`}
                aria-label={`React with ${e}`}
                onClick={() => react(e)}
                className="grid size-8 place-items-center rounded-md text-base hover:bg-hover"
              >
                {e}
              </button>
            ))}
            <div className="relative">
              <IconButton label="Add reaction" active={!!picker} onClick={openPicker}>
                <SmilePlus size={16} />
              </IconButton>
              {picker && <EmojiPicker onPick={pick} onClose={closePicker} below={picker.below} />}
            </div>
          </>
        )}
        <IconButton label="Reply" onClick={p.onReply}>
          <Reply size={16} />
        </IconButton>
        {p.canEdit && p.m.content && (
          <IconButton label="Edit" onClick={() => (setDraft(tokensToNames(p.m.content, view)), setEditing(true))}>
            <Pencil size={16} />
          </IconButton>
        )}
        {p.canDelete && (
          <IconButton label="Delete" danger onClick={() => confirm('Delete this message?') && zz.attempt(() => zz.api.deleteMessage(p.m.id))}>
            <Trash2 size={16} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

const isTimedOut = (until: string | null | undefined) => !!until && new Date(until).getTime() > Date.now();

/** Reaction chips under a message: click to add / remove yours; hover shows who reacted. */
function Reactions(p: { m: LocalMessage; sessionId: string; me: string; disabled: boolean; onToggle: (emoji: string) => void; onMore: () => void }) {
  const view = useApp((s) => s.sessions[p.sessionId]);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {p.m.reactions.map((r) => {
        const mine = r.userIds.includes(p.me);
        const names = r.userIds.map((id) => (id === p.me ? 'You' : memberName(view, id)));
        const who = names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', ');
        return (
          <button
            key={r.emoji}
            disabled={p.disabled}
            onClick={() => p.onToggle(r.emoji)}
            title={`${who} reacted with ${r.emoji}`}
            aria-label={`${r.emoji} ${r.userIds.length}${mine ? ', including you' : ''}`}
            aria-pressed={mine}
            className={cx(
              'flex h-7 items-center gap-1.5 rounded-lg border px-2 text-sm transition disabled:cursor-not-allowed',
              mine ? 'border-brand bg-brand/20 text-fg' : 'border-transparent bg-side text-muted hover:border-line',
            )}
          >
            <span className="text-base leading-none">{r.emoji}</span>
            <span className="text-xs font-semibold tabular-nums">{r.userIds.length}</span>
          </button>
        );
      })}
      {!p.disabled && (
        <button
          onClick={p.onMore}
          className="grid h-7 w-8 place-items-center rounded-lg bg-side text-muted opacity-0 transition group-hover:opacity-100 hover:text-fg focus:opacity-100"
          aria-label="Add reaction"
          title="Add reaction"
        >
          <SmilePlus size={15} />
        </button>
      )}
    </div>
  );
}

const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** While I'm timed out the composer is replaced by a countdown (reading still works). */
function ComposerOrTimeout({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const until = useApp((s) => s.sessions[sessionId]?.members[s.me!.id]?.timeoutUntil ?? null);
  const [, tick] = useState(0);
  const end = until ? new Date(until).getTime() : 0;
  useEffect(() => {
    if (end <= Date.now()) return;
    const t = setInterval(() => tick((n) => n + 1), 1000); // re-render every second
    return () => clearInterval(t);
  }, [end]);
  const now = Date.now();
  if (end <= now) return <>{children}</>;
  return (
    <div className="shrink-0 px-4 pb-4 safe-bottom">
      <div role="status" className="flex items-center gap-3 rounded-lg bg-warn/15 px-4 py-3 text-sm text-warn">
        <Clock size={18} className="shrink-0" />
        <span className="flex-1">You are timed out and can’t send messages or react. You can still read the chat.</span>
        <span className="font-mono font-semibold tabular-nums">{fmtLeft(end - now)}</span>
      </div>
    </div>
  );
}
