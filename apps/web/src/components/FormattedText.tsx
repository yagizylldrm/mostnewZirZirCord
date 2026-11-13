import { memberName } from '@zirzircord/client-core';
import { type FormatNode, parseFormat, splitMentions } from '@zirzircord/shared';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { ui, useApp } from '../lib/zz';
import { cx } from './ui';

/** Hidden until clicked. */
function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={shown ? undefined : 'Spoiler, click to reveal'}
      onClick={() => setShown(true)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setShown(true)}
      className={cx('rounded px-0.5', shown ? 'bg-field' : 'cursor-pointer select-none bg-faint text-transparent hover:bg-muted')}
    >
      {children}
    </span>
  );
}

/**
 * Message text: markdown-style formatting (see packages/shared/src/format.ts), links,
 * @mention pills and @everyone. Everything is rendered as React nodes, never as HTML.
 */
export function FormattedText({ text, sessionId }: { text: string; sessionId: string }) {
  const view = useApp((s) => s.sessions[sessionId]);
  const nodes = useMemo(() => parseFormat(text), [text]);

  const mentions = (value: string) =>
    splitMentions(value).map((part, i) =>
      part.type === 'text' ? (
        <Fragment key={i}>{part.text}</Fragment>
      ) : (
        <button
          key={i}
          className="rounded bg-brand/20 px-1 font-medium text-brand hover:bg-brand/30"
          onClick={(e) => part.type === 'user' && ui.setState({ profile: { userId: part.userId, sessionId, x: e.clientX, y: e.clientY } })}
        >
          @{part.type === 'everyone' ? 'everyone' : memberName(view, part.userId)}
        </button>
      ),
    );

  const render = (list: FormatNode[]): ReactNode =>
    list.map((n, i) => {
      switch (n.type) {
        case 'text':
          return <Fragment key={i}>{mentions(n.text)}</Fragment>;
        case 'url':
          return (
            <a key={i} href={n.url} target="_blank" rel="noreferrer noopener" className="text-sky-400 hover:underline">
              {n.url}
            </a>
          );
        case 'bold':
          return <strong key={i}>{render(n.children)}</strong>;
        case 'italic':
          return <em key={i}>{render(n.children)}</em>;
        case 'underline':
          return <u key={i}>{render(n.children)}</u>;
        case 'strike':
          return <s key={i}>{render(n.children)}</s>;
        case 'spoiler':
          return <Spoiler key={i}>{render(n.children)}</Spoiler>;
        case 'code':
          return (
            <code key={i} className="rounded bg-field px-1 py-0.5 font-mono text-[13px]">
              {n.text}
            </code>
          );
        case 'codeblock':
          return (
            <pre key={i} className="my-1 max-w-full overflow-x-auto rounded-md bg-elev px-3 py-2 font-mono text-[13px] leading-snug whitespace-pre">
              {n.text}
            </pre>
          );
        case 'quote':
          return (
            <div key={i} className="my-0.5 border-l-4 border-line pl-3 text-muted">
              {render(n.children)}
            </div>
          );
      }
    });

  return <>{render(nodes)}</>;
}
