import { describe, expect, it } from 'vitest';
import { guestAuthSchema, nameProblem, registerSchema } from '..';

describe('nameProblem', () => {
  it('accepts plain names of 6+ characters', () => {
    expect(nameProblem('Yagiz1')).toBeNull();
    expect(nameProblem('Ağaç_Güneş')).toBeNull();
    expect(nameProblem('  UxTester  ')).toBeNull(); // trimmed first
  });

  it('rejects short names, counting characters not code units', () => {
    expect(nameProblem('Mobil')).toMatch(/At least 6/);
    expect(nameProblem('')).toMatch(/At least 6/);
    expect(nameProblem('😀😀😀😀😀')).toMatch(/At least 6/); // 5 emoji
    expect(nameProblem('😀😀😀😀😀😀')).toBeNull(); // 6 emoji
  });

  it('rejects spaces and every kind of blank character', () => {
    for (const bad of ['Yağız Efe', 'ab\tcdef', 'abc def', 'abc​def', 'abcㅤdef', 'ㅤㅤㅤㅤㅤㅤ', '⠀⠀⠀⠀⠀⠀', 'abc‮def', 'abc­def', 'abc\ndef']) {
      expect(nameProblem(bad), JSON.stringify(bad)).toMatch(/No spaces/);
    }
  });

  it('keeps emoji sequences working (ZWJ and variation selectors do not count)', () => {
    expect(nameProblem('👨‍👩‍👧‍👦abcde')).toBeNull();
    expect(nameProblem('❤️❤️❤️❤️❤️')).toMatch(/At least 6/);
  });
});

describe('auth schemas use it', () => {
  const base = { deviceId: 'device-12345' };
  it('guest and register need a valid name', () => {
    expect(guestAuthSchema.safeParse({ ...base, displayName: 'Mobil' }).success).toBe(false);
    expect(guestAuthSchema.safeParse({ ...base, displayName: 'Mobil1' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, displayName: 'a b c d e f', email: 'a@b.co', password: '12345678' }).success).toBe(false);
  });
});
