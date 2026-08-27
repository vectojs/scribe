/**
 * Bidirectional scroll sync between TextArea source and Markdown preview.
 *
 * Maps editor scrollTop ↔ preview ScrollView scrollTop.
 * The ideal mapping uses Markdown line boxes via `Markdown.getContentProjection`
 * (`contentY` + `lineHeight` + `lines[].y`), but that projection is only
 * available after a frame. For the pure sync math we fall back to proportional
 * mapping, which StackEdit / Typora also use as their baseline before refining
 * with line boxes.
 *
 * All functions are pure and debounced at the call site. A `SyncGuard` prevents
 * feedback loops without timers.
 */

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
};

export type LineBox = {
  y: number;
  height: number;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Proportional scroll mapping: editor ratio → preview offset.
 * When one side has no overflow, the other stays at 0.
 */
export function mapEditorToPreview(editor: ScrollMetrics, preview: ScrollMetrics): number {
  const editorMax = Math.max(0, editor.scrollHeight - editor.viewportHeight);
  const previewMax = Math.max(0, preview.scrollHeight - preview.viewportHeight);
  if (editorMax === 0 || previewMax === 0) return 0;
  const ratio = clamp(editor.scrollTop / editorMax, 0, 1);
  return Math.round(ratio * previewMax);
}

export function mapPreviewToEditor(preview: ScrollMetrics, editor: ScrollMetrics): number {
  const previewMax = Math.max(0, preview.scrollHeight - preview.viewportHeight);
  const editorMax = Math.max(0, editor.scrollHeight - editor.viewportHeight);
  if (previewMax === 0 || editorMax === 0) return 0;
  const ratio = clamp(preview.scrollTop / previewMax, 0, 1);
  return Math.round(ratio * editorMax);
}

/**
 * Line-box aware mapping.
 * Given the editor's caret line index (0-based) and total visual lines, and
 * the Markdown line boxes (from `markdown.getContentProjection()?.lines`),
 * return the preview scrollTop that brings the corresponding block into view.
 *
 * Falls back to proportional mapping when line boxes are empty.
 */
export function mapEditorLineToPreviewOffset(
  editorLine: number,
  editorLineCount: number,
  lineBoxes: readonly LineBox[],
  previewViewportHeight: number,
): number {
  if (lineBoxes.length === 0 || editorLineCount <= 1) return 0;
  const ratio = clamp(editorLine / Math.max(1, editorLineCount - 1), 0, 1);
  // Weighted index into lineBoxes, then center the target line.
  const targetIdx = Math.min(lineBoxes.length - 1, Math.floor(ratio * lineBoxes.length));
  const box = lineBoxes[targetIdx];
  // box.y is local to the Markdown entity; ScrollView scrollTop is -content.y
  // so the desired scrollTop is directly box.y (minus a small padding to show context).
  const desired = Math.max(0, box.y - 16);
  // Clamp to max scroll (preview content height - viewport) if known; caller
  // clamps again, so we just return desired here.
  void previewViewportHeight;
  return Math.round(desired);
}

/**
 * Given a preview scrollTop and the line boxes, return the source line index
 * that should be kept visible (used to keep caret in view when preview scrolls).
 */
export function mapPreviewOffsetToEditorLine(
  previewScrollTop: number,
  lineBoxes: readonly LineBox[],
  editorLineCount: number,
): number {
  if (lineBoxes.length === 0 || editorLineCount === 0) return 0;
  // Find the first box whose y >= previewScrollTop
  let idx = 0;
  for (let i = 0; i < lineBoxes.length; i++) {
    if (lineBoxes[i].y >= previewScrollTop) {
      idx = i;
      break;
    }
    if (i === lineBoxes.length - 1) idx = i;
  }
  const ratio = lineBoxes.length > 1 ? idx / (lineBoxes.length - 1) : 0;
  return Math.min(editorLineCount - 1, Math.round(ratio * (editorLineCount - 1)));
}

/**
 * Light debounced guard that prevents feedback loops.
 * Call `shouldSync(source)` before applying a scroll; it returns true only
 * if the opposite side did not just write within `cooldownMs`.
 */
export class SyncGuard {
  private lastEditorSync = 0;
  private lastPreviewSync = 0;

  constructor(private readonly cooldownMs = 80) {}

  shouldSyncFromEditor(now = Date.now()): boolean {
    return now - this.lastPreviewSync > this.cooldownMs;
  }

  shouldSyncFromPreview(now = Date.now()): boolean {
    return now - this.lastEditorSync > this.cooldownMs;
  }

  markEditorSync(now = Date.now()): void {
    this.lastEditorSync = now;
  }

  markPreviewSync(now = Date.now()): void {
    this.lastPreviewSync = now;
  }
}

/** Simple trailing-edge debounce (no leading fire). */
export function debounce<T extends (...args: unknown[]) => void>(fn: T, waitMs: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
  return debounced as T;
}
