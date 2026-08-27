import { describe, expect, test } from 'bun:test';

import { applyToolbarAction, type ToolbarAction } from '../src/editor/ToolbarActions';

describe('ToolbarActions', () => {
  test('bold wraps selection', () => {
    const r = applyToolbarAction(
      { value: 'hello world', selectionStart: 6, selectionEnd: 11 },
      'bold',
    );
    expect(r.value).toBe('hello **world**');
    expect(r.selectionStart).toBe(8);
    expect(r.selectionEnd).toBe(13);
  });

  test('bold with empty selection inserts placeholder and selects it', () => {
    const r = applyToolbarAction({ value: 'hi ', selectionStart: 3, selectionEnd: 3 }, 'bold');
    expect(r.value).toBe('hi **bold**');
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe('bold');
  });

  test('italic wraps', () => {
    const r = applyToolbarAction({ value: 'hello', selectionStart: 0, selectionEnd: 5 }, 'italic');
    expect(r.value).toBe('*hello*');
  });

  test('h1 prefixes lines', () => {
    const r = applyToolbarAction(
      { value: 'line one\nline two', selectionStart: 0, selectionEnd: 3 },
      'h1',
    );
    expect(r.value).toBe('# line one\nline two');
    expect(r.value.startsWith('# ')).toBe(true);
  });

  test('h1 prefixes multiple lines when selection spans them', () => {
    const full = 'line one\nline two';
    const r = applyToolbarAction(
      { value: full, selectionStart: 0, selectionEnd: full.length },
      'h1',
    );
    expect(r.value).toBe('# line one\n# line two');
  });

  test('h2 prefixes', () => {
    const r = applyToolbarAction({ value: 'Title', selectionStart: 0, selectionEnd: 5 }, 'h2');
    expect(r.value).toBe('## Title');
  });

  test('quote prefixes', () => {
    const r = applyToolbarAction({ value: 'a\nb', selectionStart: 0, selectionEnd: 3 }, 'quote');
    expect(r.value).toBe('> a\n> b');
  });

  test('code wraps', () => {
    const r = applyToolbarAction({ value: 'x = 1', selectionStart: 0, selectionEnd: 5 }, 'code');
    expect(r.value).toBe('`x = 1`');
  });

  test('link wraps with url placeholder', () => {
    const r = applyToolbarAction({ value: 'click', selectionStart: 0, selectionEnd: 5 }, 'link');
    expect(r.value).toBe('[click](https://)');
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe('click');
  });

  test('image inserts at cursor', () => {
    const r = applyToolbarAction({ value: 'hello', selectionStart: 5, selectionEnd: 5 }, 'image');
    expect(r.value).toBe('hello![alt](https://)');
    // cursor inside alt text (offset 2 after ![ )
    expect(r.selectionStart).toBe(5 + 2);
  });

  test('table inserts block', () => {
    const r = applyToolbarAction({ value: '', selectionStart: 0, selectionEnd: 0 }, 'table');
    expect(r.value).toContain('| Header 1 |');
    expect(r.value).toContain('| --- |');
  });

  test('math wraps', () => {
    const r = applyToolbarAction({ value: 'E=mc2', selectionStart: 0, selectionEnd: 5 }, 'math');
    expect(r.value).toBe('$E=mc2$');
  });

  test('mathBlock wraps', () => {
    const r = applyToolbarAction({ value: 'x^2', selectionStart: 0, selectionEnd: 3 }, 'mathBlock');
    expect(r.value).toContain('$$');
    expect(r.value).toContain('x^2');
  });

  test('clamps out-of-range selection', () => {
    const r = applyToolbarAction(
      { value: 'hi', selectionStart: -10, selectionEnd: 100 },
      'bold' as ToolbarAction,
    );
    expect(r.value).toBe('**hi**');
  });
});
