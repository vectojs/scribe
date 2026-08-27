import { describe, expect, test } from 'bun:test';

import { isComposingEvent, shortcutForChord } from '../src/editor/ToolbarActions';

describe('Shortcuts — chord mapping', () => {
  test('ctrl+b → bold', () => {
    expect(shortcutForChord('ctrl+b')).toBe('bold');
    expect(shortcutForChord('meta+b')).toBe('bold');
    expect(shortcutForChord('Ctrl+B')).toBe('bold');
  });

  test('ctrl+i → italic', () => {
    expect(shortcutForChord('ctrl+i')).toBe('italic');
  });

  test('ctrl+k → link', () => {
    expect(shortcutForChord('ctrl+k')).toBe('link');
  });

  test('ctrl+e → code', () => {
    expect(shortcutForChord('ctrl+e')).toBe('code');
  });

  test('ctrl+shift+c → codeBlock', () => {
    expect(shortcutForChord('ctrl+shift+c')).toBe('codeBlock');
  });

  test('ctrl+shift+i → image', () => {
    expect(shortcutForChord('ctrl+shift+i')).toBe('image');
  });

  test('ctrl+q → quote', () => {
    expect(shortcutForChord('ctrl+q')).toBe('quote');
  });

  test('h1-h3', () => {
    expect(shortcutForChord('ctrl+1')).toBe('h1');
    expect(shortcutForChord('ctrl+2')).toBe('h2');
    expect(shortcutForChord('ctrl+3')).toBe('h3');
  });

  test('unknown chord returns null', () => {
    expect(shortcutForChord('ctrl+alt+z')).toBeNull();
    expect(shortcutForChord('alt+x')).toBeNull();
  });

  test('ctrl+z → undo, ctrl+y / ctrl+shift+z → redo', () => {
    expect(shortcutForChord('ctrl+z')).toBe('undo');
    expect(shortcutForChord('meta+z')).toBe('undo');
    expect(shortcutForChord('ctrl+y')).toBe('redo');
    expect(shortcutForChord('meta+y')).toBe('redo');
    expect(shortcutForChord('ctrl+shift+z')).toBe('redo');
    expect(shortcutForChord('meta+shift+z')).toBe('redo');
  });

  test('isComposingEvent true for isComposing', () => {
    const e = { isComposing: true, key: 'a' } as unknown as KeyboardEvent;
    expect(isComposingEvent(e)).toBe(true);
    const p = { key: 'Process' } as unknown as KeyboardEvent;
    expect(isComposingEvent(p)).toBe(true);
    const n = { key: 'a', isComposing: false } as unknown as KeyboardEvent;
    expect(isComposingEvent(n)).toBe(false);
  });
});
