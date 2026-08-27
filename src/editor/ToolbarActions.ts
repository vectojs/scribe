/**
 * Toolbar & keyboard-shortcut markdown insertion.
 *
 * Pure helpers that operate on a TextArea value + selection, returning the
 * new value and updated selection. The view layer applies them via the
 * TextArea entity (value assignment + selectionStart/End) and then calls
 * `markdown.setContent(...)`.
 */

export type TextSelection = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export type EditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function clampSelection(sel: TextSelection): TextSelection {
  const len = sel.value.length;
  return {
    value: sel.value,
    selectionStart: Math.max(0, Math.min(len, sel.selectionStart)),
    selectionEnd: Math.max(0, Math.min(len, sel.selectionEnd)),
  };
}

function wrapSelection(
  sel: TextSelection,
  before: string,
  after: string,
  placeholder = 'text',
): EditResult {
  const { value, selectionStart, selectionEnd } = clampSelection(sel);
  const a = Math.min(selectionStart, selectionEnd);
  const b = Math.max(selectionStart, selectionEnd);
  const selected = value.slice(a, b);
  const inner = selected || placeholder;
  const next = value.slice(0, a) + before + inner + after + value.slice(b);
  const cursorStart = a + before.length;
  const cursorEnd = cursorStart + inner.length;
  return { value: next, selectionStart: cursorStart, selectionEnd: cursorEnd };
}

function prefixLines(sel: TextSelection, prefix: string): EditResult {
  const { value, selectionStart, selectionEnd } = clampSelection(sel);
  const a = Math.min(selectionStart, selectionEnd);
  const b = Math.max(selectionStart, selectionEnd);
  // Expand to full lines
  const lineStart = value.lastIndexOf('\n', a - 1) + 1;
  let lineEnd = value.indexOf('\n', b);
  if (lineEnd === -1) lineEnd = value.length;
  // If selection ends at line start (b === lineStart of next line), don't include next line
  const sliceEnd = b > 0 && value[b - 1] === '\n' && b === lineEnd + 1 ? b - 1 : lineEnd;
  void sliceEnd;
  const before = value.slice(0, lineStart);
  const target = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
  const after = value.slice(lineEnd === -1 ? value.length : lineEnd);
  const lines = target.split('\n');
  const prefixed = lines.map((l) => (l.startsWith(prefix) ? l : prefix + l)).join('\n');
  const next = before + prefixed + after;
  // Selection should cover the prefixed block
  return {
    value: next,
    selectionStart: lineStart,
    selectionEnd: lineStart + prefixed.length,
  };
}

function insertAtSelection(
  sel: TextSelection,
  insert: string,
  placeCursorInside = false,
  cursorOffset = 0,
): EditResult {
  const { value, selectionStart, selectionEnd } = clampSelection(sel);
  const a = Math.min(selectionStart, selectionEnd);
  const b = Math.max(selectionStart, selectionEnd);
  const next = value.slice(0, a) + insert + value.slice(b);
  const pos = placeCursorInside ? a + cursorOffset : a + insert.length;
  return { value: next, selectionStart: pos, selectionEnd: pos };
}

export type ToolbarAction =
  | 'bold'
  | 'italic'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'code'
  | 'codeBlock'
  | 'link'
  | 'image'
  | 'table'
  | 'math'
  | 'mathBlock';

export type HistoryAction = 'undo' | 'redo';

export function applyToolbarAction(sel: TextSelection, action: ToolbarAction): EditResult {
  switch (action) {
    case 'bold':
      return wrapSelection(sel, '**', '**', 'bold');
    case 'italic':
      return wrapSelection(sel, '*', '*', 'italic');
    case 'h1':
      return prefixLines(sel, '# ');
    case 'h2':
      return prefixLines(sel, '## ');
    case 'h3':
      return prefixLines(sel, '### ');
    case 'quote':
      return prefixLines(sel, '> ');
    case 'code':
      return wrapSelection(sel, '`', '`', 'code');
    case 'codeBlock':
      return wrapSelection(sel, '\n```\n', '\n```\n', 'code');
    case 'link':
      return wrapSelection(sel, '[', '](https://)', 'text');
    case 'image':
      return insertAtSelection(sel, '![alt](https://)', true, 2);
    case 'table':
      return insertAtSelection(
        sel,
        '\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n',
      );
    case 'math':
      return wrapSelection(sel, '$', '$', 'x');
    case 'mathBlock':
      return wrapSelection(sel, '\n$$\n', '\n$$\n', 'x^2');
    default:
      return {
        value: sel.value,
        selectionStart: sel.selectionStart,
        selectionEnd: sel.selectionEnd,
      };
  }
}

export function historyActionForChord(chord: string): HistoryAction | null {
  const c = chord.toLowerCase();
  switch (c) {
    case 'ctrl+z':
    case 'meta+z':
      return 'undo';
    case 'ctrl+y':
    case 'meta+y':
    case 'ctrl+shift+z':
    case 'meta+shift+z':
      return 'redo';
    default:
      return null;
  }
}

/**
 * Map a keyboard chord (already normalized via `normalizeChord`) to a toolbar action.
 * Returns null when the chord is not a Scribe shortcut — the caller should then
 * let the browser handle it (and must not call preventDefault, so IME stays alive).
 */
export function shortcutForChord(chord: string): ToolbarAction | HistoryAction | null {
  const c = chord.toLowerCase();
  switch (c) {
    case 'ctrl+b':
    case 'meta+b':
      return 'bold';
    case 'ctrl+i':
    case 'meta+i':
      return 'italic';
    case 'ctrl+k':
    case 'meta+k':
      return 'link';
    case 'ctrl+shift+c':
    case 'meta+shift+c':
      return 'codeBlock';
    case 'ctrl+e':
    case 'meta+e':
      return 'code';
    case 'ctrl+shift+i':
    case 'meta+shift+i':
      return 'image';
    case 'ctrl+shift+t':
    case 'meta+shift+t':
      return 'table';
    case 'ctrl+shift+m':
    case 'meta+shift+m':
      return 'math';
    case 'ctrl+1':
    case 'meta+1':
      return 'h1';
    case 'ctrl+2':
    case 'meta+2':
      return 'h2';
    case 'ctrl+3':
    case 'meta+3':
      return 'h3';
    case 'ctrl+q':
    case 'meta+q':
      return 'quote';
    case 'ctrl+z':
    case 'meta+z':
      return 'undo';
    case 'ctrl+y':
    case 'meta+y':
    case 'ctrl+shift+z':
    case 'meta+shift+z':
      return 'redo';
    default:
      return null;
  }
}

/** Whether the event is an IME composition — shortcuts must be suppressed then. */
export function isComposingEvent(e: KeyboardEvent): boolean {
  return (e as unknown as { isComposing?: boolean }).isComposing === true || e.key === 'Process';
}
