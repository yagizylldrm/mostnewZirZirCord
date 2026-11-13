import { describe, expect, it } from 'vitest';
import { can, canCreateChannel, canModerate, formatSessionCode, generatePublicId, generateSessionCode, normalizeSessionCode } from '..';

describe('session codes', () => {
  it('generates 8-char codes from the alphabet and round-trips through normalisation', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateSessionCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(normalizeSessionCode(formatSessionCode(code).toLowerCase())).toBe(code);
    }
  });
  it('maps look-alike characters and rejects junk', () => {
    expect(normalizeSessionCode('o1lI-abcd')).toBe('0111ABCD');
    expect(normalizeSessionCode('short')).toBeNull();
    expect(normalizeSessionCode('ABCD-EFGU')).toBeNull();
  });
  it('generates public ids', () => {
    expect(generatePublicId()).toMatch(/^ZZ-[0-9A-Z]{6}$/);
  });
});

describe('permissions', () => {
  it('owner can do everything, mods all but owner-only, members nothing', () => {
    expect(can('OWNER', 'session.toggleSet')).toBe(true);
    expect(can('MOD', 'session.toggleSet')).toBe(false);
    expect(can('MOD', 'session.ban')).toBe(true);
    expect(can('MEMBER', 'session.kick')).toBe(false);
    expect(can(null, 'session.kick')).toBe(false);
  });
  it('channel creation follows settings for members', () => {
    const s = { membersCanCreateText: true, membersCanCreateVoice: false };
    expect(canCreateChannel('MEMBER', 'TEXT', s)).toBe(true);
    expect(canCreateChannel('MEMBER', 'VOICE', s)).toBe(false);
    expect(canCreateChannel('MOD', 'VOICE', s)).toBe(true);
  });
  it('mods cannot moderate owner or other mods', () => {
    expect(canModerate('MOD', 'MEMBER')).toBe(true);
    expect(canModerate('MOD', 'MOD')).toBe(false);
    expect(canModerate('MOD', 'OWNER')).toBe(false);
    expect(canModerate('OWNER', 'MOD')).toBe(true);
    expect(canModerate('OWNER', 'OWNER')).toBe(false);
    expect(canModerate('MEMBER', 'MEMBER')).toBe(false);
  });
});

import { canMentionEveryone, isJumboEmoji, neutralizeEveryone, parseMentions, splitMentions } from '..';

describe('mentions', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  it('parses user tokens and @everyone', () => {
    expect(parseMentions(`hi <@${id}> and <@${id}> @everyone`)).toEqual({ userIds: [id], everyone: true });
    expect(parseMentions('mail me at a@everyone.com').everyone).toBe(false);
  });
  it('neutralised @everyone is not a mention and renders as text', () => {
    const n = neutralizeEveryone('hey @everyone');
    expect(parseMentions(n).everyone).toBe(false);
    expect(splitMentions(n).every((p) => p.type === 'text')).toBe(true);
  });
  it('splits into parts', () => {
    expect(splitMentions(`a <@${id}> b @everyone`)).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'user', userId: id },
      { type: 'text', text: ' b ' },
      { type: 'everyone' },
    ]);
  });
  it('detects jumbo emoji', () => {
    expect(isJumboEmoji('😂')).toBe(true);
    expect(isJumboEmoji('👍🏽 🇹🇷 ❤️')).toBe(true);
    expect(isJumboEmoji('😂 lol')).toBe(false);
    expect(isJumboEmoji('😂😂😂😂😂😂😂')).toBe(false);
  });
  it('@everyone permission follows the owner setting', () => {
    expect(canMentionEveryone('MEMBER', { membersCanMentionEveryone: false })).toBe(false);
    expect(canMentionEveryone('MEMBER', { membersCanMentionEveryone: true })).toBe(true);
    expect(canMentionEveryone('MOD', { membersCanMentionEveryone: false })).toBe(true);
  });
});

describe('reaction emoji', async () => {
  const { reactionEmojiSchema } = await import('..');
  const ok = (e: string) => reactionEmojiSchema.safeParse(e).success;
  it('accepts emoji, skin tones, ZWJ sequences, flags and keycaps', () => {
    for (const e of ['👍', '👍🏽', '❤️', '👨‍👩‍👧', '🇹🇷', '1️⃣', '🏳️‍🌈', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) expect(ok(e), e).toBe(true);
  });
  it('rejects text', () => {
    for (const e of ['a', 'lol', '1', '#', '', 'x👍', '<script>']) expect(ok(e), e).toBe(false);
  });
});
