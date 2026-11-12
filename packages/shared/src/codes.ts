import { CODE_ALPHABET, CODE_LENGTH, PUBLIC_ID_LENGTH, PUBLIC_ID_PREFIX } from './constants';

function randomChars(len: number, rand: (n: number) => Uint8Array): string {
  const bytes = rand(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

const defaultRand = (n: number) => {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
};

/** Generates a raw 8-char session code (store this form). */
export function generateSessionCode(rand = defaultRand): string {
  return randomChars(CODE_LENGTH, rand);
}

export function generatePublicId(rand = defaultRand): string {
  return PUBLIC_ID_PREFIX + randomChars(PUBLIC_ID_LENGTH, rand);
}

/** Formats a raw code as XXXX-XXXX for display. */
export function formatSessionCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Normalises user input into the raw code form. Accepts dashes/spaces and lowercase,
 * and maps Crockford look-alikes (O→0, I/L→1). Returns null if it can't be a code.
 */
export function normalizeSessionCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}
