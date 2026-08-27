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
  ALL_PRESETS,
  getModeForPreset,
  persistPreset,
  resolveInitialPreset,
  TOKENS_BY_MODE,
  toggleMode,
  type MarkdownPreset,
  type ThemeMode,
  PRESET_FOR_MODE,
} from './editor/ThemeManager';
import { ScribeDocument } from './model/DocumentModel';
import { isValidStageSize, markdownMaxWidth } from './utils/dpr';
import { loadDocumentWithStorage, saveDocumentWithStorage } from './model/storage';
import { parseToc } from './model/toc';
import { exportHtml, exportMarkdown, exportPdf } from './view/export';
import { mountExplorer } from './view/explorer';
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
  // Responsive shell hamburger/drawer hooks (CTX-0536)
  const menuToggle = document.getElementById('scribe-menu-toggle') as HTMLButtonElement | null;
  const settingsToggle = document.getElementById(
    'scribe-settings-toggle',
  ) as HTMLButtonElement | null;
  const backdrop = document.getElementById('scribe-backdrop') as HTMLElement | null;
  const settingsPanel = document.getElementById('scribe-settings') as HTMLElement | null;

  // Collapse + theme picker hooks (CTX-0539)
  const toggleExplorerBtn = document.getElementById(
    'scribe-toggle-explorer',
  ) as HTMLButtonElement | null;
  const toggleTocBtn = document.getElementById('scribe-toggle-toc') as HTMLButtonElement | null;
  const themePicker = document.getElementById('scribe-theme-picker') as HTMLSelectElement | null;
  const settingsThemePicker = document.getElementById(
    'scribe-settings-theme-picker',
  ) as HTMLSelectElement | null;
  // WYSIWYG (Typora) — CTX-0540
  const wysiwygToggleBtn = document.getElementById(
    'scribe-wysiwyg-toggle',
  ) as HTMLButtonElement | null;
  const focusToggleBtn = document.getElementById('scribe-focus-toggle') as HTMLButtonElement | null;
  const focusModeCb = document.getElementById('scribe-focus-mode') as HTMLInputElement | null;
  const focusHighlightEl = document.getElementById('scribe-focus-highlight') as HTMLElement | null;

  if (!canvas || !stage) throw new Error('Scribe requires #scribe-canvas and #scribe-stage');

  let currentPreset: MarkdownPreset = resolveInitialPreset();
  let themeMode: ThemeMode = getModeForPreset(currentPreset);
  const applyHtmlTheme = (mode: ThemeMode): void => {
    document.documentElement.setAttribute('data-theme', mode);
  };
  applyHtmlTheme(themeMode);

  const model = createDocument();

  // ── Collapsible explorer / TOC (CTX-0539) ────────────────────────────────
  const EXPLORER_COLLAPSED_KEY = 'scribe:explorer-collapsed-v1';
  const TOC_COLLAPSED_KEY = 'scribe:toc-collapsed-v1';

  const readCollapsed = (key: string): boolean => {
    try {
      return window.localStorage.getItem(key) === 'true';
    } catch {
      return false;
    }
  };
  const writeCollapsed = (key: string, value: boolean): void => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // ignore
    }
  };

  const applyExplorerCollapsed = (collapsed: boolean): void => {
    if (!explorerNav) return;
    explorerNav.classList.toggle('is-collapsed', collapsed);
    if (toggleExplorerBtn) {
      toggleExplorerBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleExplorerBtn.textContent = collapsed ? '▶' : '◀';
      toggleExplorerBtn.setAttribute(
        'aria-label',
        collapsed ? 'Expand file explorer' : 'Collapse file explorer',
      );
    }
  };
  const applyTocCollapsed = (collapsed: boolean): void => {
    if (!tocNav) return;
    tocNav.classList.toggle('is-collapsed', collapsed);
    if (toggleTocBtn) {
      toggleTocBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleTocBtn.textContent = collapsed ? '▶' : '☷';
      toggleTocBtn.setAttribute('aria-label', collapsed ? 'Expand outline' : 'Collapse outline');
    }
  };

  const explorerCollapsed = readCollapsed(EXPLORER_COLLAPSED_KEY);
  const tocCollapsed = readCollapsed(TOC_COLLAPSED_KEY);
  applyExplorerCollapsed(explorerCollapsed);
  applyTocCollapsed(tocCollapsed);

  // Collapse toggles — persist + re-apply. ResizeObserver on stage will reflow canvas when flex gives stage more width.
  toggleExplorerBtn?.addEventListener('click', () => {
    const now = !(explorerNav?.classList.contains('is-collapsed') ?? false);
    applyExplorerCollapsed(now);
    writeCollapsed(EXPLORER_COLLAPSED_KEY, now);
    // Nudge layout even if ResizeObserver hasn't fired yet (desktop flex transition)
    window.dispatchEvent(new Event('resize'));
  });
  toggleTocBtn?.addEventListener('click', () => {
    const now = !(tocNav?.classList.contains('is-collapsed') ?? false);
    applyTocCollapsed(now);
    writeCollapsed(TOC_COLLAPSED_KEY, now);
    window.dispatchEvent(new Event('resize'));
  });

  // ── WYSIWYG view mode + Focus mode (CTX-0540, Typora-inspired) ──────────
  type ViewMode = 'source' | 'wysiwyg';
  const VIEW_MODE_KEY = 'scribe:view-mode-v1';
  const FOCUS_MODE_KEY = 'scribe:focus-mode-v1';

  const readViewMode = (): ViewMode => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === 'wysiwyg' || raw === 'source') return raw;
    } catch {
      // ignore
    }
    return 'source';
  };
  const writeViewMode = (mode: ViewMode): void => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // ignore
    }
  };
  const readFocusMode = (): boolean => {
    try {
      return window.localStorage.getItem(FOCUS_MODE_KEY) === 'true';
    } catch {
      return false;
    }
  };
  const writeFocusMode = (enabled: boolean): void => {
    try {
      window.localStorage.setItem(FOCUS_MODE_KEY, String(enabled));
    } catch {
      // ignore
    }
  };

  let viewMode: ViewMode = readViewMode();
  let focusMode = readFocusMode();

  const updateWysiwygChrome = (mode: ViewMode): void => {
    const isWysiwyg = mode === 'wysiwyg';
    if (wysiwygToggleBtn) {
      wysiwygToggleBtn.setAttribute('aria-pressed', String(isWysiwyg));
      wysiwygToggleBtn.textContent = isWysiwyg ? 'Source' : 'Live';
      wysiwygToggleBtn.title = isWysiwyg
        ? 'Switch to Source (split)'
        : 'Switch to Live / WYSIWYG (Typora)';
    }
    if (focusToggleBtn) {
      focusToggleBtn.setAttribute('aria-pressed', String(focusMode));
    }
    if (focusModeCb) focusModeCb.checked = focusMode;
    if (stage) {
      stage.classList.toggle('is-wysiwyg', isWysiwyg);
    }
    if (focusHighlightEl) {
      if (!focusMode || !isWysiwyg) {
        focusHighlightEl.hidden = true;
        focusHighlightEl.classList.remove('is-visible');
      } else {
        focusHighlightEl.hidden = false;
      }
    }
  };

  const scene = new Scene(canvas, {
    disableWindowResize: true,
    maxDPR: 3,
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
    theme: currentPreset as keyof typeof PRESET_THEMES,
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

  // Apply initial WYSIWYG chrome so stage class and toggle reflect stored mode before first layout
  updateWysiwygChrome(viewMode);

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
          if (window.innerWidth < 900) {
            (document.getElementById('scribe-explorer') as HTMLElement | null)?.classList.remove(
              'is-open',
            );
            (document.getElementById('scribe-toc') as HTMLElement | null)?.classList.remove(
              'is-open',
            );
            (document.getElementById('scribe-settings') as HTMLElement | null)?.classList.remove(
              'is-open',
            );
            const bd = document.getElementById('scribe-backdrop') as HTMLElement | null;
            if (bd) bd.hidden = true;
            document.body.style.overflow = '';
          }
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

  // Resize + split layout — DPR-aware: delegates backing-store to Scene.resize
  // (CanvasRenderer.resize: Math.round(css*dpr) max(1), NaN/Infinity→1) and guards
  // 0-height transient from iOS Safari URL-bar collapse.
  const layout = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!isValidStageSize(w, h)) return;
    scene.resize(w, h);
    void markdownMaxWidth(w);

    const availW = Math.max(320, w);
    const availH = Math.max(200, h);
    const paneH = availH - 2 * OUTER_PAD;

    if (viewMode === 'wysiwyg') {
      // Typora single surface: hide TextArea offscreen, preview fills stage
      textArea.width = 1;
      textArea.height = 1;
      textArea.x = -10000;
      textArea.y = -10000;
      previewScroll.width = Math.max(200, availW - 2 * OUTER_PAD);
      previewScroll.height = paneH;
      previewScroll.x = OUTER_PAD;
      previewScroll.y = OUTER_PAD;
      markdown.setMaxWidth(Math.max(200, previewScroll.width - 32));
      if (handle) handle.style.display = 'none';
      previewScroll.updateContentSize();
      scene.markDirty();
      return;
    }

    const editorW = Math.round((availW - GAP - HANDLE_W) * splitRatio);
    const previewW = Math.max(200, availW - editorW - GAP - HANDLE_W);

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
  // Re-apply WYSIWYG chrome now that layout has measured — ensures handle visibility + preview width are correct
  updateWysiwygChrome(viewMode);

  // ── WYSIWYG toggle wiring (Typora single surface) ─────────────────────
  const applyViewMode = (next: ViewMode): void => {
    viewMode = next;
    writeViewMode(next);
    updateWysiwygChrome(next);
    layout();
    // In WYSIWYG, preview is the editing surface — focus hidden source for typing
    if (next === 'wysiwyg') {
      const mirror = getMirrorTextarea();
      if (mirror) mirror.focus();
    }
    scene.markDirty();
  };

  wysiwygToggleBtn?.addEventListener('click', () => {
    applyViewMode(viewMode === 'wysiwyg' ? 'source' : 'wysiwyg');
  });

  const applyFocusMode = (enabled: boolean): void => {
    focusMode = enabled;
    writeFocusMode(enabled);
    updateWysiwygChrome(viewMode);
    if (focusToggleBtn) focusToggleBtn.setAttribute('aria-pressed', String(enabled));
    if (focusModeCb) focusModeCb.checked = enabled;
    // refresh highlight immediately
    queueFocusHighlight();
    scene.markDirty();
  };

  focusToggleBtn?.addEventListener('click', () => {
    applyFocusMode(!focusMode);
  });
  focusModeCb?.addEventListener('change', () => {
    applyFocusMode(!!focusModeCb.checked);
  });

  // ── Click-to-edit on preview (WYSIWYG): hit block → caret at source line ─
  const sourceLineCount = (): number => {
    try {
      return (
        (textArea as unknown as { lineOfOffset: (n: number) => number }).lineOfOffset(
          textArea.value.length,
        ) + 1
      );
    } catch {
      return textArea.value.split('\n').length || 1;
    }
  };

  const offsetForLine = (lineIdx: number): number => {
    const lines = textArea.value.split('\n');
    const clamped = Math.max(0, Math.min(lines.length - 1, lineIdx));
    let off = 0;
    for (let i = 0; i < clamped; i++) off += lines[i].length + 1;
    return Math.min(textArea.value.length, off);
  };

  const caretLine = (): number => {
    try {
      return (textArea as unknown as { lineOfOffset: (n: number) => number }).lineOfOffset(
        textArea.selectionStart,
      );
    } catch {
      return 0;
    }
  };

  const focusAtLine = (lineIdx: number): void => {
    const off = offsetForLine(lineIdx);
    textArea.selectionStart = off;
    textArea.selectionEnd = off;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = textArea.value;
      mirror.selectionStart = off;
      mirror.selectionEnd = off;
      mirror.focus();
      // Ensure IME caret visits new line
      try {
        mirror.setSelectionRange(off, off);
      } catch {
        // ignore
      }
    } else {
      (textArea as unknown as { focused: boolean }).focused = true;
      scene.markDirty();
    }
    queueFocusHighlight();
    if (viewMode === 'wysiwyg') {
      // Keep caret line roughly centered via preview scroll (Typora seam)
      const boxes = getMarkdownLineBoxes();
      const lineCount = sourceLineCount();
      if (boxes.length > 0 && lineCount > 1) {
        const ratio = Math.min(1, Math.max(0, lineIdx / Math.max(1, lineCount - 1)));
        const targetIdx = Math.min(boxes.length - 1, Math.floor(ratio * boxes.length));
        const box = boxes[targetIdx];
        if (box) {
          // Center with 1/3 viewport offset for typewriter feel
          const target = Math.max(0, box.y - previewScroll.height * 0.33);
          previewScroll.scrollTo(target);
          scene.markDirty();
        }
      }
    }
  };

  const previewYForClientY = (clientY: number): number | null => {
    const rect = stage.getBoundingClientRect();
    const yInStage = clientY - rect.top;
    // Must be inside previewScroll's stage bounds when in WYSIWYG (full) or source (right pane)
    const previewTop = (previewScroll as unknown as { y: number }).y ?? OUTER_PAD;
    const previewHeight = (previewScroll as unknown as { height: number }).height ?? 0;
    if (yInStage < previewTop || yInStage > previewTop + previewHeight) return null;
    const scrollTop = getPreviewMetrics().scrollTop;
    // contentLocalY = yInStage - previewTop + scrollTop (box.y == scrollTop for that line)
    return yInStage - previewTop + scrollTop;
  };

  const lineIdxForContentY = (contentY: number): number => {
    const boxes = getMarkdownLineBoxes();
    if (boxes.length === 0) return 0;
    // Find nearest box whose y <= contentY < y+height, otherwise closest by distance
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const inside = contentY >= b.y && contentY < b.y + b.height;
      if (inside) return i;
      const dist = Math.abs(contentY - b.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  };

  const handleStageClickForWysiwyg = (ev: MouseEvent): void => {
    if (viewMode !== 'wysiwyg') return;
    // Ignore clicks on handles/backdrop/toggles
    const target = ev.target as HTMLElement | null;
    if (
      target?.closest('#scribe-split-handle, #scribe-backdrop, button, a, input, select, textarea')
    ) {
      // Let button/input handlers run; but if it's stage/canvas itself, treat as preview click
      if (!target.closest('#scribe-stage')) return;
      if (
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT'
      )
        return;
    }
    const contentY = previewYForClientY(ev.clientY);
    if (contentY === null) return;
    const boxIdx = lineIdxForContentY(contentY);
    const boxes = getMarkdownLineBoxes();
    const lineCount = sourceLineCount();
    const lineIdx =
      boxes.length > 0 && lineCount > 1
        ? Math.min(
            lineCount - 1,
            Math.round((boxIdx / Math.max(1, boxes.length - 1)) * (lineCount - 1)),
          )
        : boxIdx;
    focusAtLine(lineIdx);
  };

  stage.addEventListener('click', handleStageClickForWysiwyg as EventListener);
  // Also canvas pointer — pointer events go via Scene but DOM click on stage is sufficient for projection hits

  // ── Focus highlight (Typora focus mode) — HTML overlay on current block ──
  const getFocusBox = (): { y: number; height: number } | null => {
    const boxes = getMarkdownLineBoxes();
    const cur = caretLine();
    const lineCount = sourceLineCount();
    if (boxes.length === 0) {
      const contentH = Math.max(previewScroll.height, markdown.height || 400);
      const ratio = lineCount > 1 ? cur / Math.max(1, lineCount - 1) : 0;
      const y = Math.round(ratio * Math.max(0, contentH - 20));
      return { y, height: 22 };
    }
    const idx =
      lineCount > 1
        ? Math.min(
            boxes.length - 1,
            Math.round((cur / Math.max(1, lineCount - 1)) * (boxes.length - 1)),
          )
        : 0;
    const b = boxes[idx];
    if (!b) return null;
    return { y: b.y, height: b.height };
  };

  const renderFocusHighlight = (): void => {
    if (!focusHighlightEl) return;
    if (!focusMode || viewMode !== 'wysiwyg') {
      focusHighlightEl.hidden = true;
      focusHighlightEl.classList.remove('is-visible');
      return;
    }
    const box = getFocusBox();
    if (!box) {
      focusHighlightEl.hidden = true;
      focusHighlightEl.classList.remove('is-visible');
      return;
    }
    const previewTop = (previewScroll as unknown as { y: number }).y ?? OUTER_PAD;
    const scrollTop = getPreviewMetrics().scrollTop;
    const top = previewTop + box.y - scrollTop;
    const height = Math.max(20, box.height);
    const previewLeft = (previewScroll as unknown as { x: number }).x ?? OUTER_PAD;
    const previewWidth = (previewScroll as unknown as { width: number }).width ?? stage.clientWidth;
    // Slight inset to match Markdown padding (32px container inset)
    const inset = 16;
    focusHighlightEl.style.top = `${Math.round(top)}px`;
    focusHighlightEl.style.left = `${Math.round(previewLeft + 8)}px`;
    focusHighlightEl.style.width = `${Math.max(120, Math.round(previewWidth - 16))}px`;
    focusHighlightEl.style.height = `${Math.round(height + 8)}px`;
    focusHighlightEl.hidden = false;
    // trigger transition
    requestAnimationFrame(() => focusHighlightEl.classList.add('is-visible'));
    void inset;
  };

  let focusRaf = 0;
  const queueFocusHighlight = (): void => {
    if (focusRaf) cancelAnimationFrame(focusRaf);
    focusRaf = requestAnimationFrame(() => {
      focusRaf = 0;
      renderFocusHighlight();
    });
  };

  // Keep highlight in sync with caret moves, scroll, and preview re-render
  const mirrorForFocus = (): HTMLTextAreaElement | null => getMirrorTextarea();
  mirrorForFocus()?.addEventListener('keyup', queueFocusHighlight);
  mirrorForFocus()?.addEventListener('click', queueFocusHighlight);
  mirrorForFocus()?.addEventListener('input', () => queueFocusHighlight());
  document.addEventListener('selectionchange', () => {
    // Only when editor has focus or wysiwyg — cheap guard
    const active = document.activeElement as HTMLElement | null;
    if (
      active?.tagName === 'TEXTAREA' ||
      !!active?.closest('[data-vecto-a11y-root], #scribe-a11y-root')
    ) {
      queueFocusHighlight();
    }
  });
  previewScroll.on('wheel', queueFocusHighlight as unknown as () => void);
  // Re-render also nudges highlight (debouncedRender does layout+markDirty)
  const prevDebounced = debouncedRender;
  void prevDebounced;
  // Hook after each markdown render: schedule highlight on next frame
  void renderMarkdownImmediate;
  // Monkey-patch via wrapper: reassign debouncedRender to also queue highlight
  // We keep original debouncedRender signature but wrap
  // Safer: just call queue after preview updates via interval fallback
  setInterval(queueFocusHighlight, 800);
  // Also when preview scrolls programmatically (TOC, wysiwyg centering)
  const origScrollTo = previewScroll.scrollTo.bind(previewScroll);
  (previewScroll as unknown as { scrollTo: (n: number) => void }).scrollTo = (n: number) => {
    origScrollTo(n);
    queueFocusHighlight();
  };
  // Initial
  queueFocusHighlight();

  // DPR change also needs reflow even when stage size hasn't changed — Scene's
  // watchDevicePixelRatio will resize backing store, but markdown maxWidth stays
  // css-based so only markDirty is needed. Add explicit DPR watcher for parity.
  let lastDpr =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const armDprWatch = (): void => {
      const cur =
        typeof window.devicePixelRatio === 'number' && Number.isFinite(window.devicePixelRatio)
          ? window.devicePixelRatio
          : 1;
      const mq = window.matchMedia(`(resolution: ${cur}dppx)`);
      const handler = (): void => {
        const next =
          typeof window.devicePixelRatio === 'number' && Number.isFinite(window.devicePixelRatio)
            ? window.devicePixelRatio
            : 1;
        if (Math.abs(next - lastDpr) <= 0.001) {
          armDprWatch();
          return;
        }
        lastDpr = next;
        layout();
        armDprWatch();
      };
      mq.addEventListener('change', handler, { once: true });
    };
    armDprWatch();
  }

  // Drag handle (disabled in WYSIWYG)
  if (handle) {
    const isWysiwygHandle = (): boolean => viewMode === 'wysiwyg';
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
      if (isWysiwygHandle()) return;
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
      if (isWysiwygHandle()) return;
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

  // Theme — preset-aware (CTX-0539): full PRESET_THEMES list, persisted via theme-preset key
  const syncThemePickers = (preset: MarkdownPreset): void => {
    if (themePicker) themePicker.value = preset;
    if (settingsThemePicker) settingsThemePicker.value = preset;
  };

  const applyThemePreset = (preset: MarkdownPreset): void => {
    if (!ALL_PRESETS.includes(preset)) return;
    currentPreset = preset;
    themeMode = getModeForPreset(preset);
    applyHtmlTheme(themeMode);
    persistPreset(preset);
    markdown.setTheme(preset as keyof typeof PRESET_THEMES);
    const tokens = TOKENS_BY_MODE[themeMode];
    textArea.bg = tokens.paneBg;
    textArea.color = tokens.shellFg;
    textArea.border = tokens.border;
    syncThemePickers(preset);
    scene.markDirty();
  };

  const updateTheme = (mode: ThemeMode): void => {
    const preset = PRESET_FOR_MODE[mode] as MarkdownPreset;
    applyThemePreset(preset);
  };

  // Initialize from stored preset
  syncThemePickers(currentPreset);
  applyThemePreset(currentPreset);

  // Toggle cycles light ↔ dark presets (githubLight ↔ dracula) for backward compat
  themeToggle?.addEventListener('click', () => {
    updateTheme(toggleMode(themeMode));
  });

  const onPresetChange = (e: Event): void => {
    const target = e.target as HTMLSelectElement;
    const val = target.value as MarkdownPreset;
    if (ALL_PRESETS.includes(val)) applyThemePreset(val);
  };
  themePicker?.addEventListener('change', onPresetChange);
  settingsThemePicker?.addEventListener('change', onPresetChange);

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

  // Explorer + TOC + Export wiring (from CTX-0534)
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
    if (window.innerWidth < 900) {
      explorerNav?.classList.remove('is-open');
      tocNav?.classList.remove('is-open');
      settingsPanel?.classList.remove('is-open');
      if (backdrop) backdrop.hidden = true;
      document.body.style.overflow = '';
    }
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
      if (window.innerWidth < 900) {
        explorerNav?.classList.remove('is-open');
        tocNav?.classList.remove('is-open');
        settingsPanel?.classList.remove('is-open');
        if (backdrop) backdrop.hidden = true;
        document.body.style.overflow = '';
      }
    });
  }

  if (tocNav || tocListEl) {
    updateToc();
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

  // --- Responsive drawer logic (<900 overlay, <640 hamburger) — CTX-0536 ---
  const isOverlay = (): boolean => window.innerWidth < 900;

  const syncDrawerA11y = (): void => {
    const explorerOpen = explorerNav?.classList.contains('is-open') ?? false;
    const tocOpen = tocNav?.classList.contains('is-open') ?? false;
    const settingsOpen = settingsPanel?.classList.contains('is-open') ?? false;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(explorerOpen || tocOpen));
    if (settingsToggle) settingsToggle.setAttribute('aria-expanded', String(settingsOpen));
    const anyOpen = explorerOpen || tocOpen || settingsOpen;
    if (backdrop) {
      backdrop.hidden = !anyOpen || !isOverlay();
      backdrop.setAttribute('aria-hidden', String(!anyOpen));
    }
    document.body.style.overflow = anyOpen && isOverlay() ? 'hidden' : '';
  };

  const closeDrawers = (): void => {
    explorerNav?.classList.remove('is-open');
    tocNav?.classList.remove('is-open');
    settingsPanel?.classList.remove('is-open');
    syncDrawerA11y();
  };

  const toggleExplorer = (): void => {
    const willOpen = !(explorerNav?.classList.contains('is-open') ?? false);
    explorerNav?.classList.toggle('is-open', willOpen);
    if (willOpen && window.innerWidth < 640) {
      settingsPanel?.classList.remove('is-open');
      tocNav?.classList.remove('is-open');
    }
    syncDrawerA11y();
  };

  const toggleSettings = (): void => {
    const willOpen = !(settingsPanel?.classList.contains('is-open') ?? false);
    settingsPanel?.classList.toggle('is-open', willOpen);
    if (willOpen && window.innerWidth < 640) {
      explorerNav?.classList.remove('is-open');
      tocNav?.classList.remove('is-open');
    }
    syncDrawerA11y();
  };

  menuToggle?.addEventListener('click', toggleExplorer);
  settingsToggle?.addEventListener('click', toggleSettings);
  backdrop?.addEventListener('click', closeDrawers);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const anyOpen =
        (explorerNav?.classList.contains('is-open') ?? false) ||
        (tocNav?.classList.contains('is-open') ?? false) ||
        (settingsPanel?.classList.contains('is-open') ?? false);
      if (anyOpen) {
        closeDrawers();
        (menuToggle ?? settingsToggle)?.focus();
      }
    }
  });

  window.addEventListener('resize', () => {
    if (!isOverlay()) closeDrawers();
    syncDrawerA11y();
  });

  syncDrawerA11y();

  // Persistence
  window.addEventListener('beforeunload', () => {
    persistDocument(model);
  });

  // Expose for devtools + e2e (CTX-0540 adds view-mode + focus helpers)
  window.__app = {
    scene,
    model,
    markdown,
    textArea,
    previewScroll,
  } as unknown as typeof window.__app & {
    stage: HTMLElement;
  };
  (window.__app as unknown as { stage: HTMLElement }).stage = stage;
  (
    window as unknown as {
      __scribeViewMode: () => string;
      __scribeApplyViewMode: (m: string) => void;
      __scribeFocusMode: () => boolean;
      __scribeApplyFocusMode: (b: boolean) => void;
      __scribeFocusAtLine: (n: number) => void;
    }
  ).__scribeViewMode = () => viewMode;
  (window as unknown as { __scribeApplyViewMode: (m: string) => void }).__scribeApplyViewMode = (
    m: string,
  ) => {
    if (m === 'wysiwyg' || m === 'source') applyViewMode(m as ViewMode);
  };
  (window as unknown as { __scribeFocusMode: () => boolean }).__scribeFocusMode = () => focusMode;
  (window as unknown as { __scribeApplyFocusMode: (b: boolean) => void }).__scribeApplyFocusMode = (
    b: boolean,
  ) => applyFocusMode(!!b);
  (window as unknown as { __scribeFocusAtLine: (n: number) => void }).__scribeFocusAtLine = (
    n: number,
  ) => focusAtLine(Math.max(0, n | 0));
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
