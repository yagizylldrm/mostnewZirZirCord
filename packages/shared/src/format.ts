/**
 * Message formatting (Discord-style markdown). The server stores the raw text; this only
 * turns it into a tree that clients render as React / native nodes, never as HTML, so
 * formatting can't inject markup.
 *
 *   **bold**  *italic*  _italic_  __underline__  ~~strike~~  ||spoiler||
 *   `code`  ```code block```  "> quote" at the start of a line  \* escapes a marker
 *
 * Markers that are unclosed, empty or next to spaces stay plain text, so "2 * 3 * 4" and
 * snake_case_names are left alone. Links and code are never styled inside.
 *
 * Two views of the same parse:
 *  - parseFormat():  the message as it is shown once sent (markers removed).
 *  - formatSpans():  the typed text with its markers kept, split into styled runs, for the
 *                    message box. Its pieces always join back to exactly the input.
 */
export type FormatNode =
  | { type: 'text'; text: string }
  | { type: 'url'; url: string }
  | { type: 'code'; text: string }
  | { type: 'codeblock'; text: string }
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'quote'; children: FormatNode[] };

type StyleType = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';

/** The parse tree plus what is needed to print the original text back (markers, escapes, line breaks). */
type RawNode =
  | { type: 'text'; text: string; raw?: string; gap?: true }
  | { type: 'url'; url: string }
  | { type: 'code'; text: string }
  | { type: 'codeblock'; text: string; open: string; tail: string }
  | { type: StyleType | 'quote'; children: RawNode[]; marker?: string };

/** Longer input is shown as-is: it keeps the parser's worst case small. */
const MAX_LENGTH = 10_000;
/** Styles nest at most this deep; deeper markers stay literal. */
const MAX_DEPTH = 6;

const URL_STICKY = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/y;
const ESCAPABLE = '*_~|`\\>';
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

/** Order matters: two-character markers are tried before the single-character ones. */
const MARKERS: Array<{ marker: string; type: StyleType }> = [
  { marker: '||', type: 'spoiler' },
  { marker: '**', type: 'bold' },
  { marker: '__', type: 'underline' },
  { marker: '~~', type: 'strike' },
  { marker: '*', type: 'italic' },
  { marker: '_', type: 'italic' },
];

function urlAt(s: string, i: number): string | null {
  URL_STICKY.lastIndex = i;
  return URL_STICKY.exec(s)?.[0] ?? null;
}

/** Index of the closing marker for an opener whose content starts at `from`, or -1. */
function findCloser(s: string, from: number, marker: string): number {
  const ch = marker[0];
  const underscore = ch === '_';
  let j = from;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', j + 1);
      if (end > j + 1) {
        j = end + 1;
        continue;
      }
    }
    if (c === 'h') {
      const u = urlAt(s, j);
      if (u) {
        j += u.length;
        continue;
      }
    }
    if (c === ch) {
      let runEnd = j;
      while (s[runEnd] === ch) runEnd++;
      const run = runEnd - j;
      if (marker.length === 1) {
        // A single "*" / "_" only closes on a run of exactly one; longer runs are other markers.
        if (run === 1 && j > from && !SPACE.test(s[j - 1]) && !WORD.test(s[j + 1] ?? '')) return j; // not mid-word (5*3 = 15 and 2*4)
      } else if (run >= 2) {
        // For "**" the closer is the last two of the run, so "***x***" closes bold around italic.
        const at = runEnd - 2;
        if (at > from && !SPACE.test(s[at - 1]) && !(underscore && WORD.test(s[at + 2] ?? ''))) return at;
      }
      j = runEnd;
      continue;
    }
    j++;
  }
  return -1;
}

function parseInline(s: string, depth: number): RawNode[] {
  const out: RawNode[] = [];
  let buf = '';
  let raw = ''; // buf as typed (an escape "\*" is "*" in buf and "\*" in raw)
  const flush = () => {
    if (buf) out.push(raw === buf ? { type: 'text', text: buf } : { type: 'text', text: buf, raw });
    buf = '';
    raw = '';
  };

  let i = 0;
  scan: while (i < s.length) {
    const c = s[i];

    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      raw += c + s[i + 1];
      i += 2;
      continue;
    }
    if (c === 'h') {
      const u = urlAt(s, i);
      if (u) {
        flush();
        out.push({ type: 'url', url: u });
        i += u.length;
        continue;
      }
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (depth < MAX_DEPTH && '*_~|'.includes(c)) {
      for (const { marker, type } of MARKERS) {
        if (!s.startsWith(marker, i)) continue;
        const next = s[i + marker.length];
        if (next === undefined || SPACE.test(next)) continue;
        if (marker.length === 1 && next === c) continue; // that's the start of a two-character marker
        if ((c === '_' || (c === '*' && marker.length === 1)) && i > 0 && WORD.test(s[i - 1])) continue; // snake_case, 5*3
        const close = findCloser(s, i + marker.length, marker);
        if (close < 0) continue;
        flush();
        out.push({ type, marker, children: parseInline(s.slice(i + marker.length, close), depth + 1) });
        i = close + marker.length;
        continue scan;
      }
    }
    buf += c;
    raw += c;
    i++;
  }
  flush();
  return out;
}

const GAP: RawNode = { type: 'text', text: '\n', gap: true };

/** Text without code blocks: quotes ("> " lines) and inline styles. */
function parseLines(segment: string): RawNode[] {
  const groups: Array<{ quote: boolean; lines: string[] }> = [];
  for (const line of segment.split('\n')) {
    const quote = line.startsWith('> ');
    const content = quote ? line.slice(2) : line;
    const last = groups[groups.length - 1];
    if (last && last.quote === quote) last.lines.push(content);
    else groups.push({ quote, lines: [content] });
  }
  const out: RawNode[] = [];
  groups.forEach((g, i) => {
    // A quote is a block, so the line break next to it is not shown; it is kept as a "gap" for formatSpans.
    if (i > 0) out.push(GAP);
    const body = parseInline(g.lines.join('\n'), 0);
    if (g.quote) out.push({ type: 'quote', children: body });
    else out.push(...body);
  });
  return out;
}

const FENCE = /```(?:[\w+#.-]*\n)?([\s\S]+?)```/g;

function parseTree(text: string): RawNode[] {
  if (!text) return [];
  if (text.length > MAX_LENGTH) return [{ type: 'text', text }];

  const out: RawNode[] = [];
  let last = 0;
  for (const m of text.matchAll(FENCE)) {
    const start = m.index ?? 0;
    // Code blocks are blocks too: the line break before and after is not shown twice.
    let before = text.slice(last, start);
    const gapBefore = before.endsWith('\n');
    if (gapBefore) before = before.slice(0, -1);
    if (before) out.push(...parseLines(before));
    if (gapBefore) out.push(GAP);
    const body = m[1];
    const code = body.replace(/\n$/, '');
    out.push({
      type: 'codeblock',
      text: code,
      open: m[0].slice(0, m[0].length - body.length - 3),
      tail: body.slice(code.length) + '```',
    });
    last = start + m[0].length;
    if (text[last] === '\n') {
      out.push(GAP);
      last++;
    }
  }
  const rest = text.slice(last);
  if (rest || !out.length) out.push(...parseLines(rest));
  return out;
}

/** The tree as shown once sent: no markers, no hidden line breaks. */
function toNodes(nodes: RawNode[]): FormatNode[] {
  const out: FormatNode[] = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!n.gap && n.text) out.push({ type: 'text', text: n.text });
    } else if (n.type === 'codeblock') out.push({ type: 'codeblock', text: n.text });
    else if (n.type === 'url' || n.type === 'code') out.push(n);
    else out.push({ type: n.type, children: toNodes(n.children) });
  }
  // Join neighbouring text nodes (escapes and split lines leave several).
  const merged: FormatNode[] = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (n.type === 'text' && prev?.type === 'text') merged[merged.length - 1] = { type: 'text', text: prev.text + n.text };
    else merged.push(n);
  }
  return merged;
}

export function parseFormat(text: string): FormatNode[] {
  return toNodes(parseTree(text));
}

// ---------------------------------------------------------------- styled runs for the message box

export interface FormatSpan {
  text: string;
  /** A formatting character (``**``, a quote's "> ", a code fence…): show it dimmed. */
  marker?: true;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  spoiler?: true;
  code?: true;
  quote?: true;
  link?: true;
}

type SpanStyle = Omit<FormatSpan, 'text' | 'marker'>;

const DEFAULT_MARKER: Record<StyleType, string> = { bold: '**', italic: '*', underline: '__', strike: '~~', spoiler: '||' };

function spansOf(nodes: RawNode[], style: SpanStyle, out: FormatSpan[]) {
  const push = (text: string, extra: SpanStyle = {}, marker = false) => {
    if (text) out.push({ text, ...(marker ? { marker: true as const } : {}), ...style, ...extra });
  };
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        push(n.raw ?? n.text);
        break;
      case 'url':
        push(n.url, { link: true });
        break;
      case 'code':
        push('`', { code: true }, true);
        push(n.text, { code: true });
        push('`', { code: true }, true);
        break;
      case 'codeblock':
        push(n.open, { code: true }, true);
        push(n.text, { code: true });
        push(n.tail, { code: true }, true);
        break;
      case 'quote': {
        const inner: FormatSpan[] = [];
        spansOf(n.children, { ...style, quote: true }, inner);
        // Every quoted line carries its own "> ".
        const prefix: FormatSpan = { text: '> ', marker: true, ...style, quote: true };
        out.push(prefix);
        for (const sp of inner) {
          const parts = sp.text.split('\n');
          parts.forEach((part, k) => {
            if (k > 0) out.push({ ...prefix });
            const text = k < parts.length - 1 ? part + '\n' : part;
            if (text) out.push({ ...sp, text });
          });
        }
        break;
      }
      default: {
        const marker = n.marker ?? DEFAULT_MARKER[n.type];
        push(marker, { [n.type]: true } as SpanStyle, true);
        spansOf(n.children, { ...style, [n.type]: true } as SpanStyle, out);
        push(marker, { [n.type]: true } as SpanStyle, true);
      }
    }
  }
}

/**
 * The typed text split into styled runs, markers included. The runs always join back to exactly
 * `text`, so an editor can draw them while the user types without changing what was typed.
 */
export function formatSpans(text: string): FormatSpan[] {
  const out: FormatSpan[] = [];
  spansOf(parseTree(text), {}, out);
  // Neighbouring runs with the same look become one.
  const merged: FormatSpan[] = [];
  for (const sp of out) {
    const prev = merged[merged.length - 1];
    const { text: t, ...rest } = sp;
    if (prev) {
      const { text: pt, ...prevRest } = prev;
      if (JSON.stringify(prevRest) === JSON.stringify(rest)) {
        merged[merged.length - 1] = { ...sp, text: pt + t };
        continue;
      }
    }
    merged.push(sp);
  }
  return merged;
}

const BLOCKS = new Set<FormatNode['type']>(['quote', 'codeblock']);

/** The message without styling, for reply previews and notifications. */
export function formatPlainText(text: string): string {
  const render = (nodes: FormatNode[]): string => {
    let out = '';
    let prev: FormatNode | undefined;
    for (const n of nodes) {
      if (prev && (BLOCKS.has(n.type) || BLOCKS.has(prev.type))) out += '\n';
      switch (n.type) {
        case 'text':
        case 'code':
        case 'codeblock':
          out += n.text;
          break;
        case 'url':
          out += n.url;
          break;
        case 'spoiler':
          out += '[spoiler]';
          break;
        default:
          out += render(n.children);
      }
      prev = n;
    }
    return out;
  };
  return render(parseFormat(text));
}
