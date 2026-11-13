import { describe, expect, it } from 'vitest';
import { type FormatNode, formatPlainText, parseFormat } from '..';

const t = (text: string): FormatNode => ({ type: 'text', text });

describe('parseFormat: inline styles', () => {
  it('leaves plain text alone', () => {
    expect(parseFormat('hello world')).toEqual([t('hello world')]);
    expect(parseFormat('')).toEqual([]);
  });

  it('parses bold, italic (both markers), underline, strike and spoiler', () => {
    expect(parseFormat('**bold**')).toEqual([{ type: 'bold', children: [t('bold')] }]);
    expect(parseFormat('*it*')).toEqual([{ type: 'italic', children: [t('it')] }]);
    expect(parseFormat('_it_')).toEqual([{ type: 'italic', children: [t('it')] }]);
    expect(parseFormat('__under__')).toEqual([{ type: 'underline', children: [t('under')] }]);
    expect(parseFormat('~~gone~~')).toEqual([{ type: 'strike', children: [t('gone')] }]);
    expect(parseFormat('||secret||')).toEqual([{ type: 'spoiler', children: [t('secret')] }]);
  });

  it('keeps the text around a style', () => {
    expect(parseFormat('a **b** c')).toEqual([t('a '), { type: 'bold', children: [t('b')] }, t(' c')]);
  });

  it('nests styles, including bold italic with three markers', () => {
    expect(parseFormat('**a *b* c**')).toEqual([{ type: 'bold', children: [t('a '), { type: 'italic', children: [t('b')] }, t(' c')] }]);
    expect(parseFormat('***both***')).toEqual([{ type: 'bold', children: [{ type: 'italic', children: [t('both')] }] }]);
  });

  it('renders inline code literally, without styling inside it', () => {
    expect(parseFormat('use `**not bold**` here')).toEqual([t('use '), { type: 'code', text: '**not bold**' }, t(' here')]);
  });
});

describe('parseFormat: things that must stay plain', () => {
  it('ignores unclosed markers', () => {
    expect(parseFormat('**oops')).toEqual([t('**oops')]);
    expect(parseFormat('half *open')).toEqual([t('half *open')]);
    expect(parseFormat('|| nothing')).toEqual([t('|| nothing')]);
  });

  it('ignores markers next to spaces, so maths and bullets are safe', () => {
    expect(parseFormat('2 * 3 * 4')).toEqual([t('2 * 3 * 4')]);
    expect(parseFormat('a ** b ** c')).toEqual([t('a ** b ** c')]);
  });

  it('does not italicise snake_case words', () => {
    expect(parseFormat('call my_function_name now')).toEqual([t('call my_function_name now')]);
    expect(parseFormat('__init__')).toEqual([{ type: 'underline', children: [t('init')] }]); // at a word start it is underline
    expect(parseFormat('file_a and file_b')).toEqual([t('file_a and file_b')]);
  });

  it('does not italicise a * inside a word, so sums are safe', () => {
    expect(parseFormat('price 5*3 = 15 and 2*4')).toEqual([t('price 5*3 = 15 and 2*4')]);
    expect(parseFormat('*real* italic')).toEqual([{ type: 'italic', children: [t('real')] }, t(' italic')]);
  });

  it('does not format empty content', () => {
    expect(parseFormat('****')).toEqual([t('****')]);
    expect(parseFormat('``')).toEqual([t('``')]);
  });

  it('honours backslash escapes', () => {
    expect(parseFormat('\\*not italic\\*')).toEqual([t('*not italic*')]);
    expect(parseFormat('\\**x**')).toEqual([t('**x**')]);
    expect(parseFormat('a \\\\ b')).toEqual([t('a \\ b')]);
  });

  it('never formats inside links', () => {
    const url = 'https://example.com/a_b_c/*x*';
    expect(parseFormat(url)).toEqual([{ type: 'url', url }]);
    expect(parseFormat(`see ${url}!`)).toEqual([t('see '), { type: 'url', url }, t('!')]);
  });

  it('passes mention tokens through inside styles', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(parseFormat(`**<@${id}>**`)).toEqual([{ type: 'bold', children: [t(`<@${id}>`)] }]);
  });
});

describe('parseFormat: blocks', () => {
  it('parses fenced code blocks, with or without a language', () => {
    expect(parseFormat('```\nline 1\nline 2\n```')).toEqual([{ type: 'codeblock', text: 'line 1\nline 2' }]);
    expect(parseFormat('```js\nlet a = 1;\n```')).toEqual([{ type: 'codeblock', text: 'let a = 1;' }]);
    expect(parseFormat('```one liner```')).toEqual([{ type: 'codeblock', text: 'one liner' }]);
  });

  it('does not style inside a code block and keeps text before and after', () => {
    expect(parseFormat('before\n```\n**x**\n```\nafter')).toEqual([t('before'), { type: 'codeblock', text: '**x**' }, t('after')]);
  });

  it('leaves an unclosed code fence as text', () => {
    expect(parseFormat('```not closed')).toEqual([t('```not closed')]);
  });

  it('parses quotes: consecutive "> " lines form one block', () => {
    expect(parseFormat('> hi\n> there\nplain')).toEqual([{ type: 'quote', children: [t('hi\nthere')] }, t('plain')]);
    expect(parseFormat('> **bold** quote')).toEqual([{ type: 'quote', children: [{ type: 'bold', children: [t('bold')] }, t(' quote')] }]);
  });

  it('only treats ">" at the start of a line as a quote', () => {
    expect(parseFormat('a > b')).toEqual([t('a > b')]);
    expect(parseFormat('>no space')).toEqual([t('>no space')]);
  });
});

describe('parseFormat: robustness', () => {
  it('skips formatting for very long input instead of doing quadratic work', () => {
    const long = `${'*a '.repeat(5000)}`;
    expect(parseFormat(long)).toEqual([t(long)]);
  });

  it('stops nesting at a fixed depth', () => {
    const deep = `${'**a '.repeat(20)}x${' a**'.repeat(20)}`;
    expect(() => parseFormat(deep)).not.toThrow();
  });
});

describe('formatPlainText', () => {
  it('strips styling for previews and notifications', () => {
    expect(formatPlainText('**bold** and *it* and `code` and ||secret||')).toBe('bold and it and code and [spoiler]');
    expect(formatPlainText('> quoted\n```\nblock\n```')).toBe('quoted\nblock');
    expect(formatPlainText('see https://a.com/x_y')).toBe('see https://a.com/x_y');
  });
});
