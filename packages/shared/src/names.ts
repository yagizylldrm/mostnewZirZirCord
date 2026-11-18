/** Rules for what people call themselves (display names and session nicknames). */

export const PERSON_NAME_MIN = 6;

// Spaces and other whitespace, invisible format characters (zero-width, bidi marks, soft hyphen …)
// and the "blank" letters (Hangul fillers, Braille blank, …) that render as nothing.
const BLANK = /[\p{White_Space}\p{Cf}\p{Cc}͏ᅟᅠ឴឵᠎⠀ㅤﾠ]/u;
// Emoji need these two joiners, so they are fine inside a name (they just don't count as characters).
const EMOJI_GLUE = /[‍️]/g;

/** Why a name is not allowed, or null when it is fine. Counts characters the way people do (an emoji is one). */
export function nameProblem(raw: string): string | null {
  const name = raw.trim().replace(EMOJI_GLUE, '');
  if (BLANK.test(name)) return 'No spaces or invisible characters, please';
  if (Array.from(name).length < PERSON_NAME_MIN) return `At least ${PERSON_NAME_MIN} characters, please`;
  return null;
}
