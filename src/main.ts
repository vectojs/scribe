import { Scene } from '@vectojs/core';
import { Markdown, PRESET_THEMES } from '@vectojs/markdown';
import { DOCUMENT_SCROLL_PHYSICS, ScrollView, TextArea } from '@vectojs/ui';

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
import { CloudSyncStub } from './model/cloudSync';
import { loadDocumentWithStorage, saveDocumentWithStorage } from './model/storage';
import { parseToc } from './model/toc';
import { exportHtml, exportMarkdown, exportPdf } from './view/export';
import { mountExplorer } from './view/explorer';
import { renderSync } from './view/sync';
import { getHeadingPositions, renderToc } from './view/toc';

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

function createDocument(): ScribeDocument {
  try {
    const loaded = loadDocumentWithStorage(window.localStorage);
    if (loaded) return loaded;
  } catch {
    // ignore
  }
  return new ScribeDocument();
}

function getMirrorTextarea(): HTMLTextAreaElement | null {
  return (
    (document.querySelector('[data-vecto-a11y-root] textarea') as HTMLTextAreaElement | null) ??
    (document.querySelector('#scribe-a11y-root textarea') as HTMLTextAreaElement | null)
  );
}

function isInA11yRoot(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest('[data-vecto-a11y-root], #scribe-a11y-root');
}

function persistDocument(doc: ScribeDocument): void {
  try {
    saveDocumentWithStorage(doc, window.localStorage);
  } catch {
    // ignore quota
  }
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
  const explorerNav = document.getElementById('scribe-explorer') as HTMLElement | null;
  const tocNav = document.getElementById('scribe-toc') as HTMLElement | null;
  const tocListEl = document.getElementById('scribe-toc-list') as HTMLElement | null;
  const exportMdBtn = document.getElementById('scribe-export-md') as HTMLElement | null;
  const exportHtmlBtn = document.getElementById('scribe-export-html') as HTMLElement | null;
  const exportPdfBtn = document.getElementById('scribe-export-pdf') as HTMLElement | null;
  const syncContainer = document.getElementById('scribe-sync') as HTMLElement | null;

  if (!canvas || !stage) throw new Error('Scribe requires #scribe-canvas and #scribe-stage');

  let themeMode: ThemeMode = resolveInitialTheme();
  const applyHtmlTheme = (mode: ThemeMode): void => {
    document.documentElement.setAttribute('data-theme', mode);
  };
  applyHtmlTheme(themeMode);

  const model = createDocument();
  const cloudSync = new CloudSyncStub(window.localStorage);

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
      if (textArea.composition) return;
      model.updateContent(model.activeId, next);
      debouncedRender(next);
      persistDocument(model);
      if (saveStatusEl) saveStatusEl.textContent = 'Edited';
    },
  });

  // Markdown preview — right pane inside ScrollView with document-like physics (no bounce)
  const initialPreviewWidth = Math.max(320, 600);
  const markdown = new Markdown(textArea.value, {
    maxWidth: initialPreviewWidth,
    theme: PRESET_FOR_MODE[themeMode] as keyof typeof PRESET_THEMES,
    selectable: true,
  });

  const previewScroll = new ScrollView({
    width: 400,
    height: 400,
    scrollPhysics: DOCUMENT_SCROLL_PHYSICS,
  });
  previewScroll.add(markdown);

  // Position entities manually: Scene has no auto-layout for this split
  textArea.x = OUTER_PAD;
  textArea.y = OUTER_PAD;
  previewScroll.x = 0;
  previewScroll.y = OUTER_PAD;

  scene.add(textArea);
  scene.add(previewScroll);
  scene.start();

  // Chrome updates (file name + save status). Explorer is handled via mountExplorer separately.
  const updateChrome = (): void => {
    const active = model.activeFile;
    if (fileNameEl) fileNameEl.textContent = active?.name ?? 'Untitled.md';
    if (saveStatusEl) saveStatusEl.textContent = 'Saved';
    // Fallback for legacy file list if explorerNav not present
    if (!explorerNav && fileListEl) {
      fileListEl.innerHTML = '';
      for (const f of model.files) {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(f.id === model.activeId));
        li.textContent = f.name;
        li.addEventListener('click', () => {
          model.setActive(f.id);
          persistDocument(model);
          const content = model.activeFile?.content ?? '';
          textArea.value = content;
          textArea.selectionStart = content.length;
          textArea.selectionEnd = content.length;
          markdown.setContent(content);
          updateChrome();
          updateToc();
          previewScroll.updateContentSize();
          scene.markDirty();
        });
        fileListEl.appendChild(li);
      }
    }
  };

  const updateToc = (): void => {
    const target = tocListEl ?? tocNav;
    if (!target) return;
    const text = model.activeFile?.content ?? textArea.value ?? '';
    const entries = parseToc(text);
    const positionMap = getHeadingPositions(markdown, text, entries);
    renderToc(
      target,
      text,
      (y) => {
        previewScroll.scrollTo(y);
        scene.markDirty();
      },
      () => positionMap,
    );
    if (tocNav && tocListEl) {
      const header = tocNav.querySelector('h2');
      if (header) header.textContent = `Outline (${entries.length})`;
    }
  };

  let livePreview = livePreviewCb?.checked ?? true;
  let scrollSyncEnabled = scrollSyncCb?.checked ?? true;

  livePreviewCb?.addEventListener('change', () => {
    livePreview = livePreviewCb.checked;
    if (livePreview) {
      const content = textArea.value;
      markdown.setContent(content);
      previewScroll.updateContentSize();
      updateToc();
      scene.markDirty();
    }
  });
  scrollSyncCb?.addEventListener('change', () => {
    scrollSyncEnabled = scrollSyncCb.checked;
  });

  const renderMarkdownImmediate = (content: string): void => {
    if (!livePreview) return;
    markdown.setContent(content);
    previewScroll.updateContentSize();
    updateChrome();
    updateToc();
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
    const lh = (() => {
      const m = /([0-9.]+)px/.exec(anyTA.font);
      const fs = m ? Number.parseFloat(m[1]) : 14;
      return fs * (anyTA.lineHeightFactor ?? 1.6);
    })();
    const innerH = anyTA.height - 2 * anyTA.padding;
    void innerH;
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
    return [];
  };

  const syncEditorToPreview = (): void => {
    if (!scrollSyncEnabled) return;
    if (!guard.shouldSyncFromEditor()) return;
    const e = getEditorMetrics();
    const p = getPreviewMetrics();
    const boxes = getMarkdownLineBoxes();
    let target = 0;
    if (boxes.length > 0) {
      target = mapEditorLineToPreviewOffset(e.caretLine, e.lineCount, boxes, p.viewportHeight);
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
    const boxes = getMarkdownLineBoxes();
    if (boxes.length > 0) {
      const targetLine = (() => {
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
      if (prop > desired && p.scrollTop > 20) desired = prop;
      const clamped = Math.max(
        0,
        Math.min(desired, Math.max(0, e.scrollHeight - e.viewportHeight)),
      );
      if (Math.abs(clamped - anyTA.scrollTop) > 2) {
        (textArea as unknown as { scrollTop: number }).scrollTop = clamped;
        const mirror = getMirrorTextarea() as HTMLElement | null;
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
      const mirror = getMirrorTextarea() as HTMLElement | null;
      if (mirror) (mirror as unknown as { scrollTop: number }).scrollTop = target;
      guard.markPreviewSync();
      scene.markDirty();
    }
  };

  const debouncedEditorSync = debounce(() => syncEditorToPreview(), 16) as () => void;
  const debouncedPreviewSync = debounce(() => syncPreviewToEditor(), 16) as () => void;

  textArea.on('scroll', () => {
    if (!scrollSyncEnabled) return;
    debouncedEditorSync();
  });
  previewScroll.on('wheel', () => {
    if (!scrollSyncEnabled) return;
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

    markdown.setMaxWidth(Math.max(200, previewW - 32));

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
    textArea.value = next.value;
    textArea.selectionStart = next.selectionStart;
    textArea.selectionEnd = next.selectionEnd;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = next.value;
      mirror.selectionStart = next.selectionStart;
      mirror.selectionEnd = next.selectionEnd;
      mirror.focus();
    } else {
      (textArea as unknown as { focused: boolean }).focused = true;
    }
    model.updateContent(model.activeId, next.value);
    renderMarkdownImmediate(next.value);
    persistDocument(model);
    if (saveStatusEl) saveStatusEl.textContent = 'Edited';
    scene.markDirty();
    setTimeout(() => {
      const m = getMirrorTextarea() as HTMLTextAreaElement | null;
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

  // Toolbar keyboard navigation (a11y polish): arrow keys rove focus, Home/End, Enter/Space activate
  const setupToolbarKeyboardNav = (): void => {
    if (!toolbarEl) return;
    const getButtons = (): HTMLButtonElement[] =>
      Array.from(toolbarEl.querySelectorAll('button[data-action]')) as HTMLButtonElement[];
    toolbarEl.addEventListener('keydown', (e) => {
      const buttons = getButtons();
      if (buttons.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const idx = buttons.indexOf(active as HTMLButtonElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const nextIdx =
          idx >= 0
            ? (idx + dir + buttons.length) % buttons.length
            : dir > 0
              ? 0
              : buttons.length - 1;
        buttons[nextIdx].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        buttons[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        buttons[buttons.length - 1].focus();
      }
    });
    // Ensure toolbar buttons are tabbable in roving manner: first is tabIndex 0, others -1 initially
    const buttons = getButtons();
    buttons.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
    });
    toolbarEl.addEventListener('focusin', (e) => {
      const target = e.target as HTMLButtonElement;
      if (target.matches('button[data-action]')) {
        buttons.forEach((b) => {
          b.tabIndex = b === target ? 0 : -1;
        });
      }
    });
  };
  setupToolbarKeyboardNav();

  // Theme toggle
  const updateTheme = (mode: ThemeMode): void => {
    themeMode = mode;
    applyHtmlTheme(mode);
    persistTheme(mode);
    const preset = PRESET_FOR_MODE[mode] as keyof typeof PRESET_THEMES;
    markdown.setTheme(preset);
    const tokens = TOKENS_BY_MODE[mode];
    textArea.bg = tokens.paneBg;
    textArea.color = tokens.shellFg;
    textArea.border = tokens.border;
    scene.markDirty();
  };
  updateTheme(themeMode);
  themeToggle?.addEventListener('click', () => {
    updateTheme(toggleMode(themeMode));
  });

  // Keyboard shortcuts via Scene channel + window fallback (without breaking IME)
  const handleShortcut = (rawChord: string, nativeEvent: KeyboardEvent): boolean => {
    if (isComposingEvent(nativeEvent)) return false;
    const action = shortcutForChord(rawChord);
    if (!action) return false;
    const active = document.activeElement;
    const isEditorFocused =
      active?.tagName === 'TEXTAREA' ||
      active?.getAttribute('role') === 'textbox' ||
      isInA11yRoot(active as Element | null) ||
      textArea.focused;
    if (active && active !== document.body && active.tagName === 'INPUT' && !isEditorFocused)
      return false;
    nativeEvent.preventDefault();
    applyAction(action);
    return true;
  };

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
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.metaKey) parts.push('meta');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      parts.push(e.key.toLowerCase());
      const chord = parts.join('+');
      handleShortcut(chord, e.nativeEvent);
    },
  );

  window.addEventListener('keydown', (e) => {
    if (isComposingEvent(e)) return;
    const chordParts: string[] = [];
    if (e.ctrlKey) chordParts.push('ctrl');
    if (e.metaKey) chordParts.push('meta');
    if (e.altKey) chordParts.push('alt');
    if (e.shiftKey) chordParts.push('shift');
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    chordParts.push(key);
    const chord = chordParts.join('+');
    const action = shortcutForChord(chord);
    if (!action) return;
    const active = document.activeElement as HTMLElement | null;
    const owns = active?.tagName === 'TEXTAREA' || isInA11yRoot(active as Element | null);
    if (!owns) return;
    e.preventDefault();
    applyAction(action);
  });

  // Explorer + TOC + Sync + Export wiring (from CTX-0534)
  const handleFileSwitch = (id: string): void => {
    try {
      model.setActive(id);
    } catch {
      return;
    }
    persistDocument(model);
    const content = model.activeFile?.content ?? '';
    textArea.value = content;
    textArea.selectionStart = content.length;
    textArea.selectionEnd = content.length;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = content;
      mirror.selectionStart = content.length;
      mirror.selectionEnd = content.length;
    }
    markdown.setContent(content);
    previewScroll.updateContentSize();
    updateChrome();
    updateToc();
    scene.markDirty();
  };

  if (explorerNav) {
    mountExplorer(explorerNav, model, () => {
      const active = model.activeFile;
      if (!active) return;
      const content = active.content;
      // Sync editor source and preview to newly active or mutated file
      textArea.value = content;
      textArea.selectionStart = content.length;
      textArea.selectionEnd = content.length;
      const mirror = getMirrorTextarea();
      if (mirror) {
        mirror.value = content;
        mirror.selectionStart = content.length;
        mirror.selectionEnd = content.length;
      }
      markdown.setContent(content);
      previewScroll.updateContentSize();
      updateChrome();
      updateToc();
      persistDocument(model);
      scene.markDirty();
    });
  }

  if (tocNav || tocListEl) {
    updateToc();
  }

  if (syncContainer) {
    renderSync(syncContainer, cloudSync);
  }

  const bindExport = (): void => {
    if (exportMdBtn) {
      exportMdBtn.addEventListener('click', () => {
        const active = model.activeFile;
        if (!active) return;
        exportMarkdown(active.name, active.content);
      });
    }
    if (exportHtmlBtn) {
      exportHtmlBtn.addEventListener('click', () => {
        const active = model.activeFile;
        if (!active) return;
        exportHtml(active.name, active.content, active.name);
      });
    }
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', () => {
        const active = model.activeFile;
        if (!active) return;
        exportPdf(active.name, active.content, active.name);
      });
    }
  };
  bindExport();

  // Initial chrome + toc
  updateChrome();
  updateToc();

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
  (window as unknown as { __scribeRenderMarkdown: () => void }).__scribeRenderMarkdown = () => {
    if (model.activeFile) {
      markdown.setContent(model.activeFile.content);
      previewScroll.updateContentSize();
      updateChrome();
      updateToc();
      scene.markDirty();
    }
  };
  (window as unknown as { __scribeUpdateToc: () => void }).__scribeUpdateToc = updateToc;
  (
    window as unknown as { __scribeHandleFileSwitch: (id: string) => void }
  ).__scribeHandleFileSwitch = handleFileSwitch;

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

  if (document.fonts?.ready) {
    void document.fonts.ready.then(() => layout());
  }
}

mountScribe();
