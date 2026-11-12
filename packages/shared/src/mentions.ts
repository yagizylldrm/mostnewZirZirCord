/**
 * Mentions are stored in message text as tokens:
 *   <@userId>   a user
 *   @everyone   everyone in the session (if allowed)
 */
const USER_TOKEN = /<@([0-9a-f-]{36})>/g;
const EVERYONE = /(^|[^\w​])@everyone\b/;

export function mentionToken(userId: string) {
  return `<@${userId}>`;
}

export function parseMentions(content: string): { userIds: string[]; everyone: boolean } {
  const userIds = [...new Set([...content.matchAll(USER_TOKEN)].map((m) => m[1]))];
  return { userIds, everyone: EVERYONE.test(content) };
}

/** Neutralises @everyone (zero-width space) when the author may not use it. */
export function neutralizeEveryone(content: string) {
  return content.replace(/@everyone\b/g, '@​everyone');
}

export type MessagePart = { type: 'text'; text: string } | { type: 'user'; userId: string } | { type: 'everyone' };

/** Splits message text into renderable parts (text / user mention / @everyone). */
export function splitMentions(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const re = /<@([0-9a-f-]{36})>|@everyone\b/g;
  let last = 0;
  for (const m of content.matchAll(re)) {
    const i = m.index ?? 0;
    // "@everyone" directly preceded by a zero-width space was neutralised.
    if (!m[1] && content[i - 1] === '​') continue;
    if (i > last) parts.push({ type: 'text', text: content.slice(last, i) });
    parts.push(m[1] ? { type: 'user', userId: m[1] } : { type: 'everyone' });
    last = i + m[0].length;
  }
  if (last < content.length) parts.push({ type: 'text', text: content.slice(last) });
  return parts;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}|\s)+$/u;

/** True for short emoji-only messages that should render large ("jumbo"). */
export function isJumboEmoji(content: string) {
  const t = content.trim();
  if (!t || !EMOJI_ONLY.test(t)) return false;
  const count = [...t.matchAll(/\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/gu)].length;
  return count > 0 && count <= 6;
}
