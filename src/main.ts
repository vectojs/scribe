import { Scene } from '@vectojs/core';
import { Markdown, PRESET_THEMES } from '@vectojs/markdown';
import { ScrollView, TextArea } from '@vectojs/ui';

import {
  debounce,
  mapEditorLineToPreviewOffset,
  mapEditorToPreview,
  mapPreviewToEditor,
  SyncGuard,
} from './editor/ScrollSync';
import {
  applyToolbarAction,
  isComposingEvent,
  shortcutForChord,
  type ToolbarAction,
} from './editor/ToolbarActions';
import {
  persistTheme,
  resolveInitialTheme,
  TOKENS_BY_MODE,
  toggleMode,
  type ThemeMode,
  PRESET_FOR_MODE,
} from './editor/ThemeManager';
import { ScribeDocument } from './model/DocumentModel';

declare global {
  interface Window {
    __app?: {
      scene: Scene;
      model: ScribeDocument;
      markdown: Markdown;
      textArea: TextArea;
      previewScroll: ScrollView;
    };
  }
}

const STORAGE_KEY = 'scribe:active-doc-v1';

function createDefaultDocument(): ScribeDocument {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        files?: { id: string; name: string; content: string }[];
        activeId?: string;
      };
      if (Array.isArray(parsed.files) && parsed.files.length > 0) {
        const doc = new ScribeDocument(parsed.files);
        if (parsed.activeId) {
          try {
            doc.setActive(parsed.activeId);
          } catch {
            // ignore stale activeId
          }
        }
        return doc;
      }
    } catch {
      // ignore corrupt storage
    }
  }
  return new ScribeDocument();
}

function persistDocument(doc: ScribeDocument): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ files: doc.files, activeId: doc.activeId }),
  );
}

function mountScribe(): void {
  const canvas = document.getElementById('scribe-canvas') as HTMLCanvasElement | null;
  const stage = document.getElementById('scribe-stage') as HTMLElement | null;
  const handle = document.getElementById('scribe-split-handle') as HTMLElement | null;
  const fileNameEl = document.getElementById('scribe-file-name') as HTMLElement | null;
  const saveStatusEl = document.getElementById('scribe-save-status') as HTMLElement | null;
  const fileListEl = document.getElementById('scribe-file-list') as HTMLElement | null;
  const toolbarEl = document.getElementById('scribe-toolbar') as HTMLElement | null;
  const themeToggle = document.getElementById('scribe-theme-toggle') as HTMLButtonElement | null;
  const livePreviewCb = document.getElementById('scribe-live-preview') as HTMLInputElement | null;
  const scrollSyncCb = document.getElementById('scribe-scroll-sync') as HTMLInputElement | null;

  if (!canvas || !stage) throw new Error('Scribe requires #scribe-canvas and #scribe-stage');

  let themeMode: ThemeMode = resolveInitialTheme();
  const applyHtmlTheme = (mode: ThemeMode): void => {
    document.documentElement.setAttribute('data-theme', mode);
  };
  applyHtmlTheme(themeMode);

  const model = createDefaultDocument();

  // Hybrid shell: Scene is confined to #scribe-stage, not full window.
  const scene = new Scene(canvas, {
    disableWindowResize: true,
  });

  // Layout constants — mainstream spacing
  const OUTER_PAD = 16;
  const GAP = 8;
  const HANDLE_W = 8;

  // Split ratio persisted in localStorage
  const SPLIT_KEY = 'scribe:split-ratio-v1';
  let splitRatio = 0.5;
  try {
    const raw = window.localStorage.getItem(SPLIT_KEY);
    if (raw) {
      const v = Number.parseFloat(raw);
      if (Number.isFinite(v) && v > 0.2 && v < 0.8) splitRatio = v;
    }
  } catch {
    // ignore
  }

  const editorFont = '14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  // TextArea source — left pane, IME/clipboard native via a11y projection
  const textArea = new TextArea({
    width: 400,
    height: 400,
    value: model.activeFile?.content ?? '# Hello Scribe\n\nStart writing markdown here.\n',
    font: editorFont,
    lineHeight: 1.6,
    padding: OUTER_PAD,
    bg: TOKENS_BY_MODE[themeMode].paneBg,
    color: TOKENS_BY_MODE[themeMode].shellFg,
    border: TOKENS_BY_MODE[themeMode].border,
    placeholder: 'Start writing markdown here…',
    label: 'Markdown source',
    onChange: (next) => {
      // Guard IME composition: TextArea already updated value/selection internally.
      // We update model + preview, but don't re-enter during composition.
      if (textArea.composition) return;
      model.updateContent(model.activeId, next);
      // Debounced preview rebuild to avoid thrashing on fast typing
      debouncedRender(next);
      persistDocument(model);
      if (saveStatusEl) saveStatusEl.textContent = 'Edited';
    },
  });

  // Markdown preview — right pane inside ScrollView
  const initialPreviewWidth = Math.max(320, 600);
  const markdown = new Markdown(textArea.value, {
    maxWidth: initialPreviewWidth,
    theme: PRESET_FOR_MODE[themeMode] as keyof typeof PRESET_THEMES,
    selectable: true,
  });

  const previewScroll = new ScrollView({
    width: 400,
    height: 400,
  });
  // Critical: document-like scroll physics (no bounce) — matches spec
  previewScroll.add(markdown);

  // Position entities manually: Scene has no auto-layout for this split
  textArea.x = OUTER_PAD;
  textArea.y = OUTER_PAD;
  previewScroll.x = 0;
  previewScroll.y = OUTER_PAD;

  scene.add(textArea);
  scene.add(previewScroll);
  scene.start();

  // Chrome updates
  const updateChrome = (): void => {
    const active = model.activeFile;
    if (fileNameEl) fileNameEl.textContent = active?.name ?? 'Untitled.md';
    if (fileListEl) {
      fileListEl.innerHTML = '';
      for (const f of model.files) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(f.id === model.activeId));
        li.textContent = f.name;
        li.addEventListener('click', () => {
          model.setActive(f.id);
          persistDocument(model);
          // Sync editor + preview to new file
          const content = model.activeFile?.content ?? '';
          textArea.value = content;
          // Keep selection at end
          textArea.selectionStart = content.length;
          textArea.selectionEnd = content.length;
          markdown.setContent(content);
          updateChrome();
          scene.markDirty();
        });
        fileListEl.appendChild(li);
      }
    }
    if (saveStatusEl) saveStatusEl.textContent = 'Saved';
  };

  let livePreview = livePreviewCb?.checked ?? true;
  let scrollSyncEnabled = scrollSyncCb?.checked ?? true;

  livePreviewCb?.addEventListener('change', () => {
    livePreview = livePreviewCb.checked;
    if (livePreview) {
      markdown.setContent(textArea.value);
      scene.markDirty();
    }
  });
  scrollSyncCb?.addEventListener('change', () => {
    scrollSyncEnabled = scrollSyncCb.checked;
  });

  const renderMarkdownImmediate = (content: string): void => {
    if (!livePreview) return;
    markdown.setContent(content);
    // After rebuild, sync preview scroll to editor ratio
    if (scrollSyncEnabled) syncEditorToPreview();
    scene.markDirty();
  };
  const debouncedRender = debounce((content: unknown) => {
    renderMarkdownImmediate(String(content));
    if (saveStatusEl) saveStatusEl.textContent = 'Saved';
    persistDocument(model);
  }, 80) as (c: string) => void;

  // --- Sync scroll: bidirectional, debounced, no loop ---
  const guard = new SyncGuard(80);

  const getEditorMetrics = (): {
    scrollTop: number;
    scrollHeight: number;
    viewportHeight: number;
    lineCount: number;
    caretLine: number;
  } => {
    const anyTA = textArea as unknown as {
      scrollTop: number;
      height: number;
      padding: number;
      lineHeightFactor: number;
      font: string;
    };
    // lineHeight in CSS px
    const lh = (() => {
      const m = /([0-9.]+)px/.exec(anyTA.font);
      const fs = m ? Number.parseFloat(m[1]) : 14;
      return fs * (anyTA.lineHeightFactor ?? 1.6);
    })();
    // Estimate editor scrollHeight from wrapped lines
    const innerH = anyTA.height - 2 * anyTA.padding;
    void innerH;
    // Use TextArea's internal line count via lineOfOffset on last offset
    const lineCount = (() => {
      try {
        return (
          (textArea as unknown as { lineOfOffset: (n: number) => number }).lineOfOffset(
            textArea.value.length,
          ) + 1
        );
      } catch {
        return textArea.value.split('\n').length || 1;
      }
    })();
    const caretLine = (() => {
      try {
        return (textArea as unknown as { lineOfOffset: (n: number) => number }).lineOfOffset(
          textArea.selectionStart,
        );
      } catch {
        return 0;
      }
    })();
    const scrollTop = anyTA.scrollTop ?? 0;
    const viewportHeight = anyTA.height - 2 * anyTA.padding;
    // scrollHeight = lineCount * lh + 2*padding (approx). Real TextArea clips to innerH, so scrollHeight = max(viewport, lines*lh+padding*2?) Align with render math.
    const contentH = lineCount * lh + 2 * anyTA.padding;
    const scrollHeight = Math.max(anyTA.height, contentH);
    return { scrollTop, scrollHeight, viewportHeight, lineCount, caretLine };
  };

  const getPreviewMetrics = (): {
    scrollTop: number;
    scrollHeight: number;
    viewportHeight: number;
  } => {
    const scrollTop = -(previewScroll as unknown as { content: { y: number } }).content.y || 0;
    const contentH =
      (previewScroll as unknown as { content: { height: number } }).content.height ||
      markdown.height ||
      0;
    const viewportHeight = previewScroll.height;
    const scrollHeight = Math.max(viewportHeight, contentH);
    return { scrollTop, scrollHeight, viewportHeight };
  };

  const getMarkdownLineBoxes = (): { y: number; height: number }[] => {
    try {
      const proj = (
        markdown as unknown as {
          getContentProjection?: () => {
            lines?: { y: number; lineHeight?: number }[] | undefined;
            contentY?: number;
          } | null;
        }
      ).getContentProjection?.();
      if (proj?.lines && proj.lines.length > 0) {
        const contentY = proj.contentY ?? 0;
        return proj.lines.map((l) => ({
          y: contentY + l.y,
          height: l.lineHeight ?? 20,
        }));
      }
    } catch {
      // ignore
    }
    // Fallback: derive from markdown.height and line count estimate
    return [];
  };

  const syncEditorToPreview = (): void => {
    if (!scrollSyncEnabled) return;
    if (!guard.shouldSyncFromEditor()) return;
    const e = getEditorMetrics();
    const p = getPreviewMetrics();
    // Prefer line-box mapping when available (StackEdit-accurate), else proportional
    const boxes = getMarkdownLineBoxes();
    let target = 0;
    if (boxes.length > 0) {
      target = mapEditorLineToPreviewOffset(e.caretLine, e.lineCount, boxes, p.viewportHeight);
      // If caret line mapping yields small value but editor is scrolled far proportionally, blend? For now prefer line mapping.
      // Fallback proportional when line mapping is near 0 but editor near bottom
      const prop = mapEditorToPreview(
        {
          scrollTop: e.scrollTop,
          scrollHeight: e.scrollHeight,
          viewportHeight: e.viewportHeight,
        },
        {
          scrollTop: 0,
          scrollHeight: p.scrollHeight,
          viewportHeight: p.viewportHeight,
        },
      );
      // Use whichever is larger when editor is scrolled (ensures not stuck at top)
      if (prop > target && e.scrollTop > 10) target = prop;
    } else {
      target = mapEditorToPreview(
        {
          scrollTop: e.scrollTop,
          scrollHeight: e.scrollHeight,
          viewportHeight: e.viewportHeight,
        },
        {
          scrollTop: 0,
          scrollHeight: p.scrollHeight,
          viewportHeight: p.viewportHeight,
        },
      );
    }
    guard.markEditorSync();
    previewScroll.scrollTo(target);
    scene.markDirty();
  };

  const syncPreviewToEditor = (): void => {
    if (!scrollSyncEnabled) return;
    if (!guard.shouldSyncFromPreview()) return;
    const e = getEditorMetrics();
    const p = getPreviewMetrics();
    // Keep caret visible: scroll editor so caret line is in view if preview moves far
    const boxes = getMarkdownLineBoxes();
    if (boxes.length > 0) {
      // Map preview offset back to editor line, then ensure editor scroll shows it
      const targetLine = (() => {
        // Reuse mapPreviewOffsetToEditorLine from ScrollSync but avoid import cycle - inline here
        let idx = 0;
        for (let i = 0; i < boxes.length; i++) {
          if (boxes[i].y >= p.scrollTop) {
            idx = i;
            break;
          }
          if (i === boxes.length - 1) idx = i;
        }
        const ratio = boxes.length > 1 ? idx / (boxes.length - 1) : 0;
        return Math.min(e.lineCount - 1, Math.round(ratio * (e.lineCount - 1)));
      })();
      const lh = (() => {
        const anyTA = textArea as unknown as {
          font: string;
          lineHeightFactor: number;
        };
        const m = /([0-9.]+)px/.exec(anyTA.font);
        const fs = m ? Number.parseFloat(m[1]) : 14;
        return fs * (anyTA.lineHeightFactor ?? 1.6);
      })();
      const caretY = targetLine * lh;
      const anyTA = textArea as unknown as {
        scrollTop: number;
        height: number;
        padding: number;
      };
      const viewportH = anyTA.height - 2 * anyTA.padding;
      let desired = anyTA.scrollTop;
      if (caretY < anyTA.scrollTop) desired = caretY;
      else if (caretY > anyTA.scrollTop + viewportH - lh) desired = caretY - viewportH + lh;
      // Also blend proportional as fallback
      const prop = mapPreviewToEditor(
        {
          scrollTop: p.scrollTop,
          scrollHeight: p.scrollHeight,
          viewportHeight: p.viewportHeight,
        },
        {
          scrollTop: 0,
          scrollHeight: e.scrollHeight,
          viewportHeight: e.viewportHeight,
        },
      );
      // If caret-derived desired is near 0 but preview is scrolled, use proportional
      if (prop > desired && p.scrollTop > 20) desired = prop;
      const clamped = Math.max(
        0,
        Math.min(desired, Math.max(0, e.scrollHeight - e.viewportHeight)),
      );
      if (Math.abs(clamped - anyTA.scrollTop) > 2) {
        (textArea as unknown as { scrollTop: number }).scrollTop = clamped;
        // Also nudge shadow textarea scrollTop directly for immediate browser sync
        const mirror = document.querySelector('#scribe-a11y-root textarea') as HTMLElement | null;
        if (mirror) (mirror as unknown as { scrollTop: number }).scrollTop = clamped;
        guard.markPreviewSync();
        scene.markDirty();
      }
      return;
    }
    const target = mapPreviewToEditor(
      {
        scrollTop: p.scrollTop,
        scrollHeight: p.scrollHeight,
        viewportHeight: p.viewportHeight,
      },
      {
        scrollTop: 0,
        scrollHeight: e.scrollHeight,
        viewportHeight: e.viewportHeight,
      },
    );
    const anyTA = textArea as unknown as { scrollTop: number };
    if (Math.abs(target - anyTA.scrollTop) > 2) {
      anyTA.scrollTop = target;
      const mirror = document.querySelector('#scribe-a11y-root textarea') as HTMLElement | null;
      if (mirror) (mirror as unknown as { scrollTop: number }).scrollTop = target;
      guard.markPreviewSync();
      scene.markDirty();
    }
  };

  const debouncedEditorSync = debounce(() => syncEditorToPreview(), 16) as () => void;
  const debouncedPreviewSync = debounce(() => syncPreviewToEditor(), 16) as () => void;

  // TextArea scroll → preview
  textArea.on('scroll', () => {
    if (!scrollSyncEnabled) return;
    debouncedEditorSync();
  });
  // Also poll TextArea scroll via a11y mirror scroll event (browser owns it)
  // The Scene already mirrors TextArea scroll via 'scroll' event above, but we also
  // handle direct wheel on editor pane by debouncing after each frame.
  // Preview scroll → editor: hook ScrollView wheel/pointer
  previewScroll.on('wheel', () => {
    if (!scrollSyncEnabled) return;
    // ScrollView's targetY updates synchronously; content.y springs, so wait a tick
    setTimeout(() => debouncedPreviewSync(), 18);
  });
  previewScroll.on('pointermove', () => {
    if (!scrollSyncEnabled) return;
    debouncedPreviewSync();
  });

  // Resize + split layout
  const layout = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const availW = Math.max(320, w);
    const availH = Math.max(200, h);
    // Single-canvas split: left = TextArea, right = ScrollView, handle in middle
    const editorW = Math.round((availW - GAP - HANDLE_W) * splitRatio);
    const previewW = Math.max(200, availW - editorW - GAP - HANDLE_W);

    const paneH = availH - 2 * OUTER_PAD;

    textArea.width = Math.max(200, editorW - OUTER_PAD);
    textArea.height = paneH;
    textArea.x = OUTER_PAD;
    textArea.y = OUTER_PAD;

    previewScroll.width = previewW;
    previewScroll.height = paneH;
    previewScroll.x = editorW + GAP + HANDLE_W;
    previewScroll.y = OUTER_PAD;

    // Markdown reflows to preview inner width (minus 32px gutter spec: 16px padding each side)
    markdown.setMaxWidth(Math.max(200, previewW - 32));

    // Position HTML handle
    if (handle) {
      const handleX = editorW + GAP;
      handle.style.left = `${handleX}px`;
      handle.style.display = availW < 600 ? 'none' : 'flex';
    }

    previewScroll.updateContentSize();
    scene.markDirty();
  };

  const observer = new ResizeObserver(layout);
  observer.observe(stage);
  // Initial
  layout();

  // Drag handle
  if (handle) {
    let dragging = false;
    let startX = 0;
    let startRatio = splitRatio;

    const onPointerMove = (ev: PointerEvent): void => {
      if (!dragging) return;
      const rect = stage.getBoundingClientRect();
      const dx = ev.clientX - startX;
      const deltaRatio = dx / Math.max(200, rect.width);
      splitRatio = Math.min(0.75, Math.max(0.25, startRatio + deltaRatio));
      layout();
    };
    const onPointerUp = (): void => {
      if (!dragging) return;
      dragging = false;
      handle.setAttribute('data-dragging', 'false');
      handle.releasePointerCapture?.(0);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      try {
        window.localStorage.setItem(SPLIT_KEY, String(splitRatio));
      } catch {
        // ignore
      }
    };
    handle.addEventListener('pointerdown', (ev) => {
      dragging = true;
      startX = (ev as PointerEvent).clientX;
      startRatio = splitRatio;
      handle.setAttribute('data-dragging', 'true');
      (handle as HTMLElement).setPointerCapture?.((ev as PointerEvent).pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      ev.preventDefault();
    });
    // Keyboard support for handle
    handle.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') {
        splitRatio = Math.max(0.25, splitRatio - 0.05);
        layout();
        try {
          window.localStorage.setItem(SPLIT_KEY, String(splitRatio));
        } catch {
          // ignore
        }
        ev.preventDefault();
      } else if (ev.key === 'ArrowRight') {
        splitRatio = Math.min(0.75, splitRatio + 0.05);
        layout();
        try {
          window.localStorage.setItem(SPLIT_KEY, String(splitRatio));
        } catch {
          // ignore
        }
        ev.preventDefault();
      }
    });
  }

  // Toolbar actions → TextArea insertion then preview rebuild
  const applyAction = (action: ToolbarAction): void => {
    const sel = {
      value: textArea.value,
      selectionStart: textArea.selectionStart,
      selectionEnd: textArea.selectionEnd,
    };
    const next = applyToolbarAction(sel, action);
    // Update TextArea model + selection
    textArea.value = next.value;
    textArea.selectionStart = next.selectionStart;
    textArea.selectionEnd = next.selectionEnd;
    // Ensure TextArea's shadow textarea reflects new value/selection
    // The a11y projection will pick up new value on next sync; also sync DOM directly for immediacy
    const mirror = document.querySelector(
      '#scribe-a11y-root textarea',
    ) as HTMLTextAreaElement | null;
    if (mirror) {
      mirror.value = next.value;
      mirror.selectionStart = next.selectionStart;
      mirror.selectionEnd = next.selectionEnd;
      mirror.focus();
    } else {
      // Fallback: focus canvas to keep keyboard channel? No — ensure TextArea focused flag?
      (textArea as unknown as { focused: boolean }).focused = true;
    }
    model.updateContent(model.activeId, next.value);
    renderMarkdownImmediate(next.value);
    persistDocument(model);
    if (saveStatusEl) saveStatusEl.textContent = 'Edited';
    scene.markDirty();
    // After action, keep focus on editor for continued typing
    setTimeout(() => {
      const m = document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null;
      m?.focus();
    }, 0);
  };

  toolbarEl?.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest(
      'button[data-action]',
    ) as HTMLButtonElement | null;
    if (!target) return;
    const action = target.getAttribute('data-action') as ToolbarAction | null;
    if (!action) return;
    ev.preventDefault();
    applyAction(action);
  });

  // Theme toggle
  const updateTheme = (mode: ThemeMode): void => {
    themeMode = mode;
    applyHtmlTheme(mode);
    persistTheme(mode);
    // Markdown preset
    const preset = PRESET_FOR_MODE[mode] as keyof typeof PRESET_THEMES;
    markdown.setTheme(preset);
    // TextArea colors follow shell tokens
    const tokens = TOKENS_BY_MODE[mode];
    textArea.bg = tokens.paneBg;
    textArea.color = tokens.shellFg;
    textArea.border = tokens.border;
    scene.markDirty();
  };
  // Init theme already applied to HTML; now sync entities
  updateTheme(themeMode);
  themeToggle?.addEventListener('click', () => {
    updateTheme(toggleMode(themeMode));
  });

  // Keyboard shortcuts via Scene channel + window fallback (without breaking IME)
  const handleShortcut = (rawChord: string, nativeEvent: KeyboardEvent): boolean => {
    // Don't handle while composing CJK
    if (isComposingEvent(nativeEvent)) return false;
    const action = shortcutForChord(rawChord);
    if (!action) return false;
    // Only when editor is focused (owns keyboard) or when no input owns it
    const active = document.activeElement;
    const isEditorFocused =
      active?.tagName === 'TEXTAREA' ||
      active?.getAttribute('role') === 'textbox' ||
      (active as HTMLElement | null)?.closest?.('#scribe-a11y-root') != null ||
      textArea.focused;
    // If some other input owns keyboard (e.g., file rename), don't hijack
    if (active && active !== document.body && active.tagName === 'INPUT' && !isEditorFocused)
      return false;
    nativeEvent.preventDefault();
    applyAction(action);
    return true;
  };

  // Scene-level channel (VectoJS keyboard system)
  scene.on(
    'keydown',
    (e: {
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
      nativeEvent: KeyboardEvent;
    }) => {
      // Build chord string like normalizeChord does: ctrl/meta + shift + key
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.metaKey) parts.push('meta');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      parts.push(e.key.toLowerCase());
      const chord = parts.join('+');
      // Also try without meta aliasing ctrl vs meta (shortcutForChord handles both)
      handleShortcut(chord, e.nativeEvent);
    },
  );

  // Window fallback for when a11y textarea owns focus (Scene channel suppressed by ownsKeyboard)
  window.addEventListener('keydown', (e) => {
    // Ignore if IME composing
    if (isComposingEvent(e)) return;
    const chordParts: string[] = [];
    if (e.ctrlKey) chordParts.push('ctrl');
    if (e.metaKey) chordParts.push('meta');
    if (e.altKey) chordParts.push('alt');
    if (e.shiftKey) chordParts.push('shift');
    // Normalize key: single char → lower, else as-is
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    chordParts.push(key);
    const chord = chordParts.join('+');
    // Only handle known shortcuts; otherwise let browser handle (crucial for IME)
    const action = shortcutForChord(chord);
    if (!action) return;
    // Only when editor projection is focused
    const active = document.activeElement as HTMLElement | null;
    const owns = active?.tagName === 'TEXTAREA' || active?.closest?.('#scribe-a11y-root') != null;
    if (!owns) return;
    e.preventDefault();
    applyAction(action);
  });

  updateChrome();

  // Persistence
  window.addEventListener('beforeunload', () => {
    persistDocument(model);
  });

  // Expose for devtools + e2e
  window.__app = { scene, model, markdown, textArea, previewScroll };
  (window as unknown as { __scribeApplyAction: (a: ToolbarAction) => void }).__scribeApplyAction =
    applyAction;
  (window as unknown as { __scribeSyncEditorToPreview: () => void }).__scribeSyncEditorToPreview =
    syncEditorToPreview;

  const maybeAttachDevtools = async (): Promise<void> => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    try {
      const { attachDevtools } = await import('@vectojs/devtools');
      attachDevtools(scene);
    } catch {
      // devtools is optional
    }
  };
  void maybeAttachDevtools();

  // Re-apply split after fonts load (affects line boxing)
  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => layout());
  }
}

mountScribe();
