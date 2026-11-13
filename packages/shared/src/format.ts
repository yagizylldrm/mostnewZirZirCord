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
 */
export type FormatNode =
  | { type: 'text'; text: string }
  | { type: 'url'; url: string }
  | { type: 'code'; text: string }
  | { type: 'codeblock'; text: string }
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler' | 'quote'; children: FormatNode[] };

/** Longer input is shown as-is: it keeps the parser's worst case small. */
const MAX_LENGTH = 10_000;
/** Styles nest at most this deep; deeper markers stay literal. */
const MAX_DEPTH = 6;

const URL_STICKY = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/y;
const ESCAPABLE = '*_~|`\\>';
const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

type StyleType = 'bold' | 'italic' | 'underline' | 'strike' | 'spoiler';
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

function parseInline(s: string, depth: number): FormatNode[] {
  const out: FormatNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };

  let i = 0;
  scan: while (i < s.length) {
    const c = s[i];

    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
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
        out.push({ type, children: parseInline(s.slice(i + marker.length, close), depth + 1) });
        i = close + marker.length;
        continue scan;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Text without code blocks: quotes ("> " lines) and inline styles. */
function parseLines(segment: string): FormatNode[] {
  const out: FormatNode[] = [];
  const lines = segment.split('\n');
  let plain: string[] = [];
  let quote: string[] = [];
  const flushPlain = () => {
    if (plain.length) out.push(...parseInline(plain.join('\n'), 0));
    plain = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push({ type: 'quote', children: parseInline(quote.join('\n'), 0) });
    quote = [];
  };
  for (const line of lines) {
    if (line.startsWith('> ')) {
      flushPlain();
      quote.push(line.slice(2));
    } else {
      // A quote is a block, so the line break right after it is not shown a second time.
      if (quote.length) flushQuote();
      plain.push(line);
    }
  }
  flushPlain();
  flushQuote();
  return mergeText(out);
}

/** Joins neighbouring text nodes (escapes and split lines leave several). */
function mergeText(nodes: FormatNode[]): FormatNode[] {
  const out: FormatNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text') last.text += n.text;
    else out.push(n);
  }
  return out;
}

const FENCE = /```(?:[\w+#.-]*\n)?([\s\S]+?)```/g;

export function parseFormat(text: string): FormatNode[] {
  if (!text) return [];
  if (text.length > MAX_LENGTH) return [{ type: 'text', text }];

  const out: FormatNode[] = [];
  let last = 0;
  for (const m of text.matchAll(FENCE)) {
    const start = m.index ?? 0;
    // Code blocks are blocks too: drop the line break before and after, so none is shown twice.
    let before = text.slice(last, start);
    if (before.endsWith('\n')) before = before.slice(0, -1);
    if (before) out.push(...parseLines(before));
    out.push({ type: 'codeblock', text: m[1].replace(/\n$/, '') });
    last = start + m[0].length;
    if (text[last] === '\n') last++;
  }
  const rest = text.slice(last);
  if (rest || !out.length) out.push(...parseLines(rest));
  return mergeText(out).filter((n) => n.type !== 'text' || n.text !== '');
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
