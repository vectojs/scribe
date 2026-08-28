import { Scene } from '@vectojs/core';
import { Markdown, PRESET_THEMES } from '@vectojs/markdown';
import { DOCUMENT_SCROLL_PHYSICS, ScrollView, TextArea } from '@vectojs/ui';
import { onMermaidCacheUpdate, registerMermaidRenderer } from './mermaid';

import {
  debounce,
  mapEditorLineToPreviewOffset,
  mapEditorToPreview,
  mapPreviewToEditor,
  SyncGuard,
  throttleRaf,
} from './editor/ScrollSync';
import {
  applyToolbarAction,
  isComposingEvent,
  shortcutForChord,
  type HistoryAction,
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
import { marked } from 'marked';

import { ScribeDocument } from './model/DocumentModel';
import { centeredPaneWidth, centeredPaneX, isValidStageSize, markdownMaxWidth } from './utils/dpr';
import {
  LEGACY_KEY,
  STORAGE_KEY,
  loadDocumentWithStorage,
  saveDocumentWithStorage,
} from './model/storage';
import { parseToc } from './model/toc';
import { exportHtml, exportMarkdown, exportPdf } from './view/export';
import { mountExplorer } from './view/explorer';
import { getHeadingPositions, renderToc } from './view/toc';
import { ensurePersisted, getLocale, setLocale, subscribe, t, type Locale } from './i18n';
import { hideContextMenu, isContextMenuVisible, showContextMenu } from './view/contextMenu';

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

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const TASK_RE = /^\s*([-+*])\s+\[([ xX])\]\s*(.*)$/;

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
  // Responsive shell hamburger/drawer hooks (CTX-0536) — explorer/toc drawers + settings modal (CTX-0543)
  const menuToggle = document.getElementById('scribe-menu-toggle') as HTMLButtonElement | null;
  const settingsToggle = document.getElementById(
    'scribe-settings-toggle',
  ) as HTMLButtonElement | null;
  // Ribbon (Obsidian-style left bar) — 48px vertical
  const ribbonEl = document.getElementById('scribe-ribbon') as HTMLElement | null;
  const ribbonFilesBtn = document.getElementById('scribe-ribbon-files') as HTMLButtonElement | null;
  const ribbonSearchBtn = document.getElementById(
    'scribe-ribbon-search',
  ) as HTMLButtonElement | null;
  const ribbonTocBtn = document.getElementById('scribe-ribbon-toc') as HTMLButtonElement | null;
  const ribbonNewBtn = document.getElementById('scribe-ribbon-new') as HTMLButtonElement | null;
  const ribbonCollapseBtn = document.getElementById(
    'scribe-ribbon-collapse',
  ) as HTMLButtonElement | null;
  const backdrop = document.getElementById('scribe-backdrop') as HTMLElement | null;
  const settingsPanel = document.getElementById('scribe-settings') as HTMLDialogElement | null;
  const settingsCloseBtn = document.getElementById(
    'scribe-settings-close',
  ) as HTMLButtonElement | null;
  const settingsWysiwygCb = document.getElementById(
    'scribe-settings-wysiwyg',
  ) as HTMLInputElement | null;
  const settingsTabButtons = Array.from(
    document.querySelectorAll('#scribe-settings [role="tab"]'),
  ) as HTMLButtonElement[];
  const settingsTabPanes = Array.from(
    document.querySelectorAll('#scribe-settings [role="tabpanel"]'),
  ) as HTMLElement[];

  // Collapse + theme picker hooks (CTX-0539)
  const toggleExplorerBtn = document.getElementById(
    'scribe-toggle-explorer',
  ) as HTMLButtonElement | null;
  const toggleTocBtn = document.getElementById('scribe-toggle-toc') as HTMLButtonElement | null;
  const themePicker = document.getElementById('scribe-theme-picker') as HTMLSelectElement | null;
  const settingsThemePicker = document.getElementById(
    'scribe-settings-theme-picker',
  ) as HTMLSelectElement | null;
  const langPicker = document.getElementById('scribe-lang-picker') as HTMLSelectElement | null;
  const settingsLangPicker = document.getElementById(
    'scribe-settings-lang-picker',
  ) as HTMLSelectElement | null;
  const headerEl = document.getElementById('scribe-header') as HTMLElement | null;
  const toolbarGroupEls = toolbarEl ? Array.from(toolbarEl.querySelectorAll('.toolbar-group')) : [];
  // WYSIWYG (Typora) — CTX-0540
  const wysiwygToggleBtn = document.getElementById(
    'scribe-wysiwyg-toggle',
  ) as HTMLButtonElement | null;
  const focusToggleBtn = document.getElementById('scribe-focus-toggle') as HTMLButtonElement | null;
  const focusModeCb = document.getElementById('scribe-focus-mode') as HTMLInputElement | null;
  const focusHighlightEl = document.getElementById('scribe-focus-highlight') as HTMLElement | null;
  // View mode 3-state (Obsidian: Reading / Source / Live Preview) — CTX-0549
  const viewModeSelect = document.getElementById('scribe-view-mode') as HTMLSelectElement | null;
  const settingsViewModeSelect = document.getElementById(
    'scribe-settings-view-mode',
  ) as HTMLSelectElement | null;
  // Inline WYSIWYG (Obsidian Live Preview) — CTX-0541+ Phase 2
  const inlineSourceEl = document.getElementById('scribe-inline-source') as HTMLElement | null;
  // Status bar word count (CTX-0545) + visible overlay scrollbars (8px, always visible)
  const wordCountEl = document.getElementById('scribe-wordcount') as HTMLElement | null;
  const statusRightEl = document.getElementById('scribe-status-right') as HTMLElement | null;
  const scrollbarEditorEl = document.getElementById(
    'scribe-scrollbar-editor',
  ) as HTMLElement | null;
  const scrollbarEditorThumb = scrollbarEditorEl?.querySelector(
    '.scribe-scrollbar__thumb',
  ) as HTMLElement | null;
  const scrollbarPreviewEl = document.getElementById(
    'scribe-scrollbar-preview',
  ) as HTMLElement | null;
  const scrollbarPreviewThumb = scrollbarPreviewEl?.querySelector(
    '.scribe-scrollbar__thumb',
  ) as HTMLElement | null;

  if (!canvas || !stage) throw new Error('Scribe requires #scribe-canvas and #scribe-stage');

  // ── i18n: default zh-CN, persisted, html lang synced ─────────────────────
  ensurePersisted();
  const initialLocale = getLocale();
  // ensure html lang matches (ensurePersisted already does, but keep explicit)
  document.documentElement.lang = initialLocale === 'zh-CN' ? 'zh-CN' : 'en';

  let currentPreset: MarkdownPreset = resolveInitialPreset();
  let themeMode: ThemeMode = getModeForPreset(currentPreset);
  const applyHtmlTheme = (mode: ThemeMode): void => {
    document.documentElement.setAttribute('data-theme', mode);
  };
  applyHtmlTheme(themeMode);

  // ── Word count stats (CTX-0545) — CJK-aware: each han char = 1 word ──────
  const computeWordStats = (value: string): { chars: number; words: number; lines: number } => {
    const chars = value.length;
    const lines = value.length === 0 ? 0 : value.split('\n').length;
    const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length;
    const latinPart = value.replace(/[\u4e00-\u9fff]/g, ' ');
    const latinWords =
      latinPart.trim() === '' ? 0 : latinPart.trim().split(/\s+/).filter(Boolean).length;
    const words = cjk + latinWords;
    return { chars, words, lines };
  };
  // Word-count updater is assigned after TextArea is created (needs closure over it)
  let updateWordCount: () => void = () => {};

  const model = createDocument();
  // Localize default file names for fresh installs when locale is zh-CN
  try {
    const hasPrimary = !!window.localStorage.getItem(STORAGE_KEY);
    const hasLegacy = !!window.localStorage.getItem(LEGACY_KEY);
    const isFresh = !hasPrimary && !hasLegacy;
    if (isFresh && getLocale() === 'zh-CN') {
      const mapping: Record<string, string> = {
        'Kitchen Sink.md': t('files.kitchenSink'),
        'Welcome.md': t('files.welcome'),
        'Notes.md': t('files.notes'),
      };
      for (const f of model.files) {
        const translated = mapping[f.name];
        if (translated && translated !== f.name) {
          try {
            model.renameFile(f.id, translated);
          } catch {
            // ignore
          }
        }
      }
      // persist renamed defaults immediately
      try {
        saveDocumentWithStorage(model, window.localStorage);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore storage errors
  }

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
        collapsed ? t('header.expand.explorer') : t('header.collapse.explorer'),
      );
      toggleExplorerBtn.title = collapsed
        ? t('header.expand.explorer')
        : t('header.collapse.explorer');
    }
    if (ribbonFilesBtn) {
      ribbonFilesBtn.setAttribute('aria-pressed', String(!collapsed));
      ribbonFilesBtn.classList.toggle('is-active', !collapsed);
      ribbonFilesBtn.setAttribute(
        'aria-label',
        collapsed ? t('header.expand.explorer') : t('header.collapse.explorer'),
      );
      ribbonFilesBtn.title = collapsed
        ? t('header.expand.explorer')
        : t('header.collapse.explorer');
    }
  };
  const applyTocCollapsed = (collapsed: boolean): void => {
    if (!tocNav) return;
    tocNav.classList.toggle('is-collapsed', collapsed);
    if (toggleTocBtn) {
      toggleTocBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleTocBtn.textContent = collapsed ? '▶' : '☷';
      toggleTocBtn.setAttribute(
        'aria-label',
        collapsed ? t('header.expand.outline') : t('header.collapse.outline'),
      );
      toggleTocBtn.title = collapsed ? t('header.expand.outline') : t('header.collapse.outline');
    }
    if (ribbonTocBtn) {
      ribbonTocBtn.setAttribute('aria-pressed', String(!collapsed));
      ribbonTocBtn.classList.toggle('is-active', !collapsed);
      ribbonTocBtn.setAttribute(
        'aria-label',
        collapsed ? t('header.expand.outline') : t('header.collapse.outline'),
      );
      ribbonTocBtn.title = collapsed ? t('header.expand.outline') : t('header.collapse.outline');
    }
  };

  const explorerCollapsed = readCollapsed(EXPLORER_COLLAPSED_KEY);
  const tocCollapsed = readCollapsed(TOC_COLLAPSED_KEY);
  applyExplorerCollapsed(explorerCollapsed);
  applyTocCollapsed(tocCollapsed);

  // ── Ribbon collapsed (Obsidian-style: collapsible 48px bar, persists) ────────
  const RIBBON_COLLAPSED_KEY = 'scribe:ribbon-collapsed-v1';
  const applyRibbonCollapsed = (collapsed: boolean): void => {
    if (!ribbonEl) return;
    ribbonEl.classList.toggle('is-collapsed', collapsed);
    if (ribbonCollapseBtn) {
      const label = collapsed ? t('ribbon.expand') : t('ribbon.collapse');
      ribbonCollapseBtn.setAttribute('aria-label', label);
      ribbonCollapseBtn.title = label;
      // rotate chevron via aria-expanded for CSS hook if needed
      ribbonCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
    }
    // Ensure ribbon buttons reflect current state when collapsing/expanding
    // Do not alter explorer/toc collapsed here — they keep their own keys
  };
  const ribbonCollapsedInit = (() => {
    try {
      return window.localStorage.getItem(RIBBON_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  })();
  applyRibbonCollapsed(ribbonCollapsedInit);
  ribbonCollapseBtn?.addEventListener('click', () => {
    const now = !(ribbonEl?.classList.contains('is-collapsed') ?? false);
    applyRibbonCollapsed(now);
    try {
      window.localStorage.setItem(RIBBON_COLLAPSED_KEY, String(now));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event('resize'));
  });

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

  // ── Ribbon wiring: Files / Search / TOC / New → explorer / toc / settings ──
  const isOverlayForRibbon = (): boolean => window.innerWidth < 900;
  const toggleExplorerForRibbon = (): void => {
    if (isOverlayForRibbon()) {
      const willOpen = !(explorerNav?.classList.contains('is-open') ?? false);
      explorerNav?.classList.toggle('is-open', willOpen);
      if (willOpen && window.innerWidth < 640) tocNav?.classList.remove('is-open');
      // sync backdrop/aria via helper if available (syncDrawerA11y defined later) — fallback:
      const backdropEl = document.getElementById('scribe-backdrop') as HTMLElement | null;
      if (backdropEl) backdropEl.hidden = !(explorerNav?.classList.contains('is-open') ?? false);
      if (willOpen) document.body.style.overflow = 'hidden';
      else if (!(tocNav?.classList.contains('is-open') ?? false)) document.body.style.overflow = '';
      // Update aria
      const menuToggleEl2 = document.getElementById(
        'scribe-menu-toggle',
      ) as HTMLButtonElement | null;
      if (menuToggleEl2) menuToggleEl2.setAttribute('aria-expanded', String(willOpen));
    } else {
      const now = !(explorerNav?.classList.contains('is-collapsed') ?? false);
      applyExplorerCollapsed(now);
      writeCollapsed(EXPLORER_COLLAPSED_KEY, now);
      window.dispatchEvent(new Event('resize'));
    }
  };
  const toggleTocForRibbon = (): void => {
    if (isOverlayForRibbon()) {
      const willOpen = !(tocNav?.classList.contains('is-open') ?? false);
      tocNav?.classList.toggle('is-open', willOpen);
      if (willOpen && window.innerWidth < 640) explorerNav?.classList.remove('is-open');
      const backdropEl = document.getElementById('scribe-backdrop') as HTMLElement | null;
      const anyOpen =
        (explorerNav?.classList.contains('is-open') ?? false) ||
        (tocNav?.classList.contains('is-open') ?? false);
      if (backdropEl) backdropEl.hidden = !anyOpen;
      document.body.style.overflow = anyOpen ? 'hidden' : '';
      const menuToggleEl2 = document.getElementById(
        'scribe-menu-toggle',
      ) as HTMLButtonElement | null;
      if (menuToggleEl2) menuToggleEl2.setAttribute('aria-expanded', String(anyOpen));
    } else {
      const now = !(tocNav?.classList.contains('is-collapsed') ?? false);
      applyTocCollapsed(now);
      writeCollapsed(TOC_COLLAPSED_KEY, now);
      window.dispatchEvent(new Event('resize'));
    }
  };
  ribbonFilesBtn?.addEventListener('click', toggleExplorerForRibbon);
  ribbonTocBtn?.addEventListener('click', toggleTocForRibbon);
  ribbonSearchBtn?.addEventListener('click', () => {
    // Search is placeholder (no dedicated search UI yet) — focus explorer and ensure visible.
    // In overlay: open explorer drawer; on desktop: expand if collapsed.
    if (isOverlayForRibbon()) {
      if (!(explorerNav?.classList.contains('is-open') ?? false)) toggleExplorerForRibbon();
      // flash explorer border to indicate placeholder
      if (explorerNav) {
        explorerNav.style.transition = 'box-shadow 200ms';
        explorerNav.style.boxShadow = 'inset 0 0 0 2px var(--scribe-accent)';
        window.setTimeout(() => {
          if (explorerNav) explorerNav.style.boxShadow = '';
        }, 600);
      }
    } else {
      if (explorerNav?.classList.contains('is-collapsed')) {
        applyExplorerCollapsed(false);
        writeCollapsed(EXPLORER_COLLAPSED_KEY, false);
        window.dispatchEvent(new Event('resize'));
      }
      // same flash
      if (explorerNav) {
        explorerNav.style.transition = 'box-shadow 200ms';
        explorerNav.style.boxShadow = 'inset 0 0 0 2px var(--scribe-accent)';
        window.setTimeout(() => {
          if (explorerNav) explorerNav.style.boxShadow = '';
        }, 600);
      }
    }
  });
  ribbonNewBtn?.addEventListener('click', () => {
    try {
      // Prefer clicking the explorer's + button if it exists (handles model + storage + rerender)
      // The first button in explorerNav header is the add button (textContent === '+')
      const addBtn = explorerNav
        ? (Array.from(explorerNav.querySelectorAll('button')).find(
            (b) => b.textContent === '+',
          ) as HTMLButtonElement | null)
        : null;
      if (addBtn) {
        addBtn.click();
        // Ensure explorer visible
        if (isOverlayForRibbon()) {
          if (!(explorerNav?.classList.contains('is-open') ?? false)) {
            explorerNav?.classList.add('is-open');
            const bd2 = document.getElementById('scribe-backdrop') as HTMLElement | null;
            if (bd2) bd2.hidden = false;
            document.body.style.overflow = 'hidden';
          }
        } else {
          if (explorerNav?.classList.contains('is-collapsed')) {
            applyExplorerCollapsed(false);
            writeCollapsed(EXPLORER_COLLAPSED_KEY, false);
            window.dispatchEvent(new Event('resize'));
          }
        }
        return;
      }
      // Fallback: direct model push if explorer not yet mounted
      const pattern = t('files.untitledPattern');
      const suffix = String(Date.now() % 1000);
      const name = pattern.includes('{n}')
        ? pattern.replace('{n}', suffix)
        : `Untitled-${suffix}.md`;
      const entry = model.addFile(name, `# ${name.replace('.md', '')}\n\n`);
      saveDocumentWithStorage(model, window.localStorage);
      if (isOverlayForRibbon()) {
        explorerNav?.classList.add('is-open');
        const bd = document.getElementById('scribe-backdrop') as HTMLElement | null;
        if (bd) bd.hidden = false;
        document.body.style.overflow = 'hidden';
      } else if (explorerNav?.classList.contains('is-collapsed')) {
        applyExplorerCollapsed(false);
        writeCollapsed(EXPLORER_COLLAPSED_KEY, false);
        window.dispatchEvent(new Event('resize'));
      }
      void entry;
      // Trigger a rerender via resize; actual editor sync will happen on next mountExplorer callback if available
      window.dispatchEvent(new Event('resize'));
    } catch {
      // ignore
    }
  });

  // ── WYSIWYG view mode + Focus mode (CTX-0540, Typora-inspired) ──────────
  type ViewMode = 'source' | 'live' | 'reading';
  const VIEW_MODE_KEY = 'scribe:view-mode-v1';
  const FOCUS_MODE_KEY = 'scribe:focus-mode-v1';

  const readViewMode = (): ViewMode => {
    try {
      const raw = window.localStorage.getItem(VIEW_MODE_KEY);
      if (raw === 'live' || raw === 'reading' || raw === 'source') return raw as ViewMode;
      if (raw === 'wysiwyg') return 'live';
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

  const updateViewModeChrome = (mode: ViewMode): void => {
    const isLive = mode === 'live';
    const isReading = mode === 'reading';
    const isSource = mode === 'source';
    const isLiveLike = isLive || isReading;
    if (wysiwygToggleBtn) {
      // Legacy toggle: pressed when not in source (live or reading)
      wysiwygToggleBtn.setAttribute('aria-pressed', String(isLiveLike));
      if (isLiveLike) {
        wysiwygToggleBtn.textContent = t('toolbar.wysiwyg.source');
        wysiwygToggleBtn.title = t('toolbar.wysiwyg.titleSource');
      } else {
        wysiwygToggleBtn.textContent = t('toolbar.wysiwyg.live');
        wysiwygToggleBtn.title = t('toolbar.wysiwyg.titleLive');
      }
      wysiwygToggleBtn.setAttribute('aria-label', t('toolbar.wysiwyg.label'));
      // Disable editing hint in reading: button still enabled to exit reading -> source
      wysiwygToggleBtn.disabled = false;
    }
    if (viewModeSelect) {
      viewModeSelect.value = mode;
      viewModeSelect.setAttribute('aria-label', t('toolbar.viewMode.select.label'));
      viewModeSelect.title = t('toolbar.viewMode.select.title');
      // update option texts for current locale
      const optReading = viewModeSelect.querySelector(
        'option[value="reading"]',
      ) as HTMLOptionElement | null;
      const optSource = viewModeSelect.querySelector(
        'option[value="source"]',
      ) as HTMLOptionElement | null;
      const optLive = viewModeSelect.querySelector(
        'option[value="live"]',
      ) as HTMLOptionElement | null;
      if (optReading) optReading.textContent = t('toolbar.viewMode.reading');
      if (optSource) optSource.textContent = t('toolbar.viewMode.source');
      if (optLive) optLive.textContent = t('toolbar.viewMode.live');
    }
    if (settingsViewModeSelect) {
      settingsViewModeSelect.value = mode;
      const oR = settingsViewModeSelect.querySelector(
        'option[value="reading"]',
      ) as HTMLOptionElement | null;
      const oS = settingsViewModeSelect.querySelector(
        'option[value="source"]',
      ) as HTMLOptionElement | null;
      const oL = settingsViewModeSelect.querySelector(
        'option[value="live"]',
      ) as HTMLOptionElement | null;
      if (oR) oR.textContent = t('settings.viewMode.reading');
      if (oS) oS.textContent = t('settings.viewMode.source');
      if (oL) oL.textContent = t('settings.viewMode.live');
    }
    if (focusToggleBtn) {
      focusToggleBtn.textContent = t('toolbar.focus.text');
      focusToggleBtn.title = t('toolbar.focus.title');
      focusToggleBtn.setAttribute('aria-label', t('toolbar.focus.label'));
    }
    if (focusToggleBtn) {
      focusToggleBtn.setAttribute('aria-pressed', String(focusMode));
      // Focus disabled in reading
      (focusToggleBtn as HTMLButtonElement).disabled = isReading;
      if (isReading) focusToggleBtn.setAttribute('aria-disabled', 'true');
      else focusToggleBtn.removeAttribute('aria-disabled');
    }
    if (focusModeCb) {
      focusModeCb.checked = focusMode;
      focusModeCb.disabled = isReading;
    }
    if (settingsWysiwygCb) settingsWysiwygCb.checked = isLive;
    if (stage) {
      stage.classList.toggle('is-wysiwyg', isLiveLike);
      stage.classList.toggle('is-live', isLive);
      stage.classList.toggle('is-reading', isReading);
      stage.classList.toggle('is-source', isSource);
    }
    // For toolbar dimming via CSS
    try {
      document.documentElement.setAttribute('data-view-mode', mode);
    } catch {}
    // Toolbar editing buttons disabled in reading
    if (toolbarEl) {
      const editBtns = toolbarEl.querySelectorAll(
        'button[data-action]',
      ) as NodeListOf<HTMLButtonElement>;
      editBtns.forEach((btn) => {
        btn.disabled = isReading;
        if (isReading) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
      });
    }
    // Settings inline buttons also disabled in reading
    if (settingsViewModeSelect) {
      // nothing
    }
    const inlineBtns = document.querySelectorAll<HTMLButtonElement>(
      '.scribe-settings__inline-btn[data-action]',
    );
    inlineBtns.forEach((btn) => {
      btn.disabled = isReading;
      if (isReading) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
    });
    if (focusHighlightEl) {
      if (!focusMode || !isLive) {
        focusHighlightEl.hidden = true;
        focusHighlightEl.classList.remove('is-visible');
      } else {
        focusHighlightEl.hidden = false;
      }
    }
    if (inlineSourceEl) {
      if (!isLive) {
        inlineSourceEl.hidden = true;
        inlineSourceEl.classList.remove('is-visible');
      }
      // In live, visibility is driven by renderInlineWysiwyg; keep hidden until that runs
    }
  };
  // Alias for backward compat (old name)
  const updateWysiwygChrome = updateViewModeChrome;

  const scene = new Scene(canvas, {
    disableWindowResize: true,
    maxDPR: 3,
  });

  // Layout constants — mainstream spacing + centered reading column (Obsidian/Typora)
  const OUTER_PAD = 16;
  const GAP = 8;
  const HANDLE_W = 8;
  // Obsidian/Typora centered layout: max 800-900 with balanced side gutters
  const CENTERED_MAX_WIDTH = 860;
  const CENTERED_GUTTER_MIN = 12;
  const MARKDOWN_INNER_PAD = 32;

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
  // Keep lastRenderedValue to avoid rebuilding preview when only selection changed (drag selection spam)
  let lastRenderedValue =
    model.activeFile?.content ?? '# Hello Scribe\n\nStart writing markdown here.\n';
  const textArea = new TextArea({
    width: 400,
    height: 400,
    value: lastRenderedValue,
    font: editorFont,
    lineHeight: 1.6,
    padding: OUTER_PAD,
    bg: TOKENS_BY_MODE[themeMode].paneBg,
    color: TOKENS_BY_MODE[themeMode].shellFg,
    border: TOKENS_BY_MODE[themeMode].border,
    placeholder:
      getLocale() === 'zh-CN' ? '在此开始书写 Markdown…' : 'Start writing markdown here…',
    label: getLocale() === 'zh-CN' ? 'Markdown 源码' : 'Markdown source',
    onChange: (next) => {
      if (textArea.composition) return;
      // Selection-only changes (dragging to select) fire 'change' with same value — don't rebuild preview
      const isValueChange = next !== lastRenderedValue;
      if (isValueChange) {
        const prev = model.activeFile?.content ?? '';
        model.history.push(model.activeId, {
          value: prev,
          selectionStart: textArea.selectionStart,
          selectionEnd: textArea.selectionEnd,
        });
      }
      // Bug A fix: typing x inside "[]" should keep cursor inside brackets (old+1), not after "]"
      // Detect single-char insertion between "[" and "]" where cursor jumped after "]"
      if (isValueChange) {
        const prevVal = lastRenderedValue;
        const curSel = textArea.selectionStart;
        // Only when selection is collapsed
        if (textArea.selectionStart === textArea.selectionEnd) {
          let diffIdx = 0;
          const minLen = Math.min(prevVal.length, next.length);
          while (diffIdx < minLen && prevVal[diffIdx] === next[diffIdx]) diffIdx++;
          // Check insertion of 1 char between "[" and "]" (empty brackets "[]")
          if (
            next.length === prevVal.length + 1 &&
            diffIdx > 0 &&
            diffIdx < prevVal.length &&
            prevVal[diffIdx - 1] === '[' &&
            prevVal[diffIdx] === ']'
          ) {
            // New value should have "[" at diffIdx-1, inserted char at diffIdx, "]" at diffIdx+1
            if (next[diffIdx - 1] === '[' && next[diffIdx + 1] === ']') {
              const expected = diffIdx + 1; // after inserted char, before "]"
              if (curSel === expected + 1) {
                const fixed = expected;
                textArea.selectionStart = fixed;
                textArea.selectionEnd = fixed;
                const mirrorFix = getMirrorTextarea();
                if (mirrorFix) {
                  try {
                    mirrorFix.selectionStart = fixed;
                    mirrorFix.selectionEnd = fixed;
                    (mirrorFix as HTMLTextAreaElement).setSelectionRange(fixed, fixed);
                  } catch {
                    // ignore
                  }
                }
              }
            }
          } else if (
            // Replacement inside "[ ]" (space) -> "[x]" : same length, single char change inside brackets
            next.length === prevVal.length &&
            diffIdx > 0 &&
            diffIdx < prevVal.length &&
            prevVal[diffIdx - 1] === '[' &&
            prevVal[diffIdx + 1] === ']' &&
            (prevVal[diffIdx] === ' ' || prevVal[diffIdx] === 'x' || prevVal[diffIdx] === 'X') &&
            (next[diffIdx] === 'x' || next[diffIdx] === 'X' || next[diffIdx] === ' ')
          ) {
            // Single char replacement inside brackets, e.g. "[ ]" -> "[x]"
            const expected = diffIdx + 1;
            if (curSel === expected + 1) {
              const fixed = expected;
              textArea.selectionStart = fixed;
              textArea.selectionEnd = fixed;
              const mirrorFix2 = getMirrorTextarea();
              if (mirrorFix2) {
                try {
                  mirrorFix2.selectionStart = fixed;
                  mirrorFix2.selectionEnd = fixed;
                  (mirrorFix2 as HTMLTextAreaElement).setSelectionRange(fixed, fixed);
                } catch {
                  // ignore
                }
              }
            }
          }
        }
      }
      model.updateContent(model.activeId, next);
      if (isValueChange) {
        lastRenderedValue = next;
        debouncedRender(next);
        try {
          queueInlineWysiwyg();
        } catch {
          // ignore before init
        }
      } else {
        // Selection-only change still may affect inline WYSIWYG active block
        try {
          queueInlineWysiwyg();
        } catch {
          // ignore
        }
      }
      persistDocument(model);
      if (saveStatusEl) saveStatusEl.textContent = t('header.save.edited');
      updateWordCount();
    },
  });

  // Word-count status bar helper — defined after textArea so it closes over it
  updateWordCount = (): void => {
    if (!wordCountEl) return;
    const value = textArea?.value ?? model.activeFile?.content ?? '';
    const { chars, words, lines } = computeWordStats(value ?? '');
    try {
      wordCountEl.textContent = t('status.wordCount', { chars, words, lines });
    } catch {
      wordCountEl.textContent = `${chars} / ${words} / ${lines}`;
    }
    if (statusRightEl) {
      const selLen = Math.abs((textArea?.selectionEnd ?? 0) - (textArea?.selectionStart ?? 0));
      if (selLen > 0) {
        try {
          statusRightEl.textContent = t('status.wordCount.chars', {
            count: selLen,
          });
        } catch {
          statusRightEl.textContent = `${selLen} selected`;
        }
      } else {
        statusRightEl.textContent = '';
      }
    }
  };

  // Mermaid spike — must register before Markdown instantiation so the
  // first preview render can prefetch the chunk and fallback to CodeBlock
  // until the async SVG is ready (handled via onMermaidCacheUpdate below).
  try {
    registerMermaidRenderer();
  } catch (e) {
    console.error('[mermaid] registration failed', e);
  }

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

  // When a mermaid diagram finishes async rendering, its SVG is cached and we
  // rebuild markdown so the cached SVGEntity replaces the CodeBlock placeholder.
  // Placed AFTER previewScroll so the closure captures the initialized variable.
  try {
    onMermaidCacheUpdate(() => {
      try {
        markdown.setContent(textArea.value);
        previewScroll.updateContentSize();
        scene.markDirty();
      } catch {
        // ignore
      }
    });
    window.addEventListener('scribe:mermaid-ready', () => {
      try {
        markdown.setContent(textArea.value);
        previewScroll.updateContentSize();
        scene.markDirty();
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }

  // Wire link navigation: external → new tab, internal #anchor → preview scroll
  const handleLinkClick = (url: string): void => {
    try {
      if (url.startsWith('#')) {
        const slug = slugifyHeading(decodeURIComponent(url.slice(1)));
        const text = model.activeFile?.content ?? textArea.value ?? '';
        const entries = parseToc(text);
        const positionMap = getHeadingPositions(markdown, text, entries);
        // Find first heading whose slug matches
        const found = entries.find((e) => slugifyHeading(e.text) === slug);
        // Try positionMap first
        let y: number | undefined;
        if (found) {
          y = positionMap.get(found.id);
        }
        if (y === undefined) {
          // Fallback: search markdown content line boxes
          const boxes: { y: number; height: number }[] = (() => {
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
          })();
          // approximate: find heading text in source, map proportionally
          if (found) {
            const lines = text.split('\n');
            const lineIdx = lines.findIndex((l) => l.includes(found.text));
            if (lineIdx >= 0 && boxes.length > 0) {
              const lineCount = lines.length;
              const ratio = lineCount > 1 ? lineIdx / Math.max(1, lineCount - 1) : 0;
              const targetIdx = Math.min(boxes.length - 1, Math.floor(ratio * boxes.length));
              y = boxes[targetIdx]?.y ?? 0;
            }
          }
        }
        if (typeof y === 'number') {
          previewScroll.scrollTo(y);
          scene.markDirty();
          return;
        }
        // Fallback: try to find element with that id in DOM (for non-vecto anchors)
        const el = document.getElementById(slug) ?? document.querySelector(`[id="${slug}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // External link — open safely
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        // ignore
      }
    }
  };
  markdown.onLinkClick = handleLinkClick;

  // ── Task list toggle — click on checkbox glyph in preview → flip source "- [ ]" ↔ "- [x]" ──
  const toggleTaskAtSourceLine = (lineIdx: number): boolean => {
    const raw = textArea.value;
    const lines = raw.split('\n');
    if (lineIdx < 0 || lineIdx >= lines.length) return false;
    const line = lines[lineIdx];
    const m = TASK_RE.exec(line);
    if (!m) return false;
    const wasChecked = m[2].toLowerCase() === 'x';
    const nextMark = wasChecked ? ' ' : 'x';
    // Preserve leading marker and spacing, only flip the checkbox char
    const nextLine = line.replace(TASK_RE, (_all: string, p1: string, _p2: string, p3: string) => {
      return `${p1} [${nextMark}] ${p3}`;
    });
    lines[lineIdx] = nextLine;
    const finalValue = lines.join('\n');
    textArea.value = finalValue;
    lastRenderedValue = finalValue;
    // Bug A: preserve cursor inside task brackets instead of jumping to 0
    const lineStartOffset = lines.slice(0, lineIdx).join('\n').length + (lineIdx > 0 ? 1 : 0);
    const bracketPosInNext = nextLine.indexOf('[');
    const newSel =
      bracketPosInNext >= 0
        ? Math.min(lineStartOffset + bracketPosInNext + 2, lineStartOffset + nextLine.length)
        : lineStartOffset;
    textArea.selectionStart = newSel;
    textArea.selectionEnd = newSel;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = finalValue;
      mirror.selectionStart = newSel;
      mirror.selectionEnd = newSel;
      try {
        mirror.focus();
        (mirror as HTMLTextAreaElement).setSelectionRange(newSel, newSel);
      } catch {
        // ignore
      }
    } else {
      (textArea as unknown as { focused: boolean }).focused = true;
    }
    model.updateContent(model.activeId, finalValue);
    markdown.setContent(finalValue);
    previewScroll.updateContentSize();
    updateChrome();
    updateToc();
    updateWordCount();
    persistDocument(model);
    if (saveStatusEl) saveStatusEl.textContent = 'Edited';
    scene.markDirty();
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore early
    }
    try {
      queueFocusHighlight();
    } catch {
      // ignore
    }
    return true;
  };

  // Expose for e2e / devtools
  (
    window as unknown as { __scribeToggleTaskAtLine: (n: number) => boolean }
  ).__scribeToggleTaskAtLine = toggleTaskAtSourceLine;

  const tryToggleTaskForClientXY = (clientX: number, clientY: number): boolean => {
    // Must be inside previewScroll viewport
    const rect = stage.getBoundingClientRect();
    const previewX = (previewScroll as unknown as { x: number }).x ?? OUTER_PAD;
    const previewTop = (previewScroll as unknown as { y: number }).y ?? OUTER_PAD;
    const previewWidth = (previewScroll as unknown as { width: number }).width ?? 400;
    const previewHeight = (previewScroll as unknown as { height: number }).height ?? 400;
    const xInStage = clientX - rect.left;
    const yInStage = clientY - rect.top;
    if (xInStage < previewX || xInStage > previewX + previewWidth) return false;
    if (yInStage < previewTop || yInStage > previewTop + previewHeight) return false;
    // Require click near left edge where checkbox glyph lives (within 48px from preview left)
    const localX = xInStage - previewX;
    if (localX > 56) return false;
    const scrollTop = -(previewScroll as unknown as { content: { y: number } }).content.y || 0;
    const contentY = yInStage - previewTop + scrollTop;
    // Map contentY to source line via same ratio as wysiwyg handler
    const boxes = (() => {
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
          const contentY0 = proj.contentY ?? 0;
          return proj.lines.map((l) => ({
            y: contentY0 + l.y,
            height: l.lineHeight ?? 20,
          }));
        }
      } catch {
        // ignore
      }
      return [];
    })();
    let boxIdx = 0;
    if (boxes.length > 0) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const inside = contentY >= b.y && contentY < b.y + b.height;
        if (inside) {
          boxIdx = i;
          break;
        }
        const dist = Math.abs(contentY - b.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      if (boxes[boxIdx] === undefined) boxIdx = best;
    } else {
      // No projection — approximate via preview height
      const contentH = Math.max(previewScroll.height, markdown.height || 400);
      const ratio = contentH > 0 ? Math.min(1, Math.max(0, contentY / contentH)) : 0;
      const lineCount = textArea.value.split('\n').length || 1;
      boxIdx = Math.min(boxes.length - 1, Math.floor(ratio * Math.max(1, lineCount - 1)));
    }
    const lineCount = textArea.value.split('\n').length || 1;
    const srcLine =
      boxes.length > 0 && lineCount > 1
        ? Math.min(
            lineCount - 1,
            Math.round((boxIdx / Math.max(1, boxes.length - 1)) * (lineCount - 1)),
          )
        : boxIdx;
    // Verify that source line is actually a task line; otherwise don't intercept
    const srcLines = textArea.value.split('\n');
    const cand = srcLines[srcLine] ?? '';
    if (!TASK_RE.test(cand)) {
      // Try neighboring lines within 2 of srcLine (ratio mapping is approximate)
      for (let d = 1; d <= 2; d++) {
        for (const off of [-d, d]) {
          const idx = srcLine + off;
          if (idx >= 0 && idx < srcLines.length && TASK_RE.test(srcLines[idx])) {
            return toggleTaskAtSourceLine(idx);
          }
        }
      }
      return false;
    }
    return toggleTaskAtSourceLine(srcLine);
  };

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
    if (fileNameEl) fileNameEl.textContent = active?.name ?? t('header.fileName.untitled');
    if (saveStatusEl) saveStatusEl.textContent = t('header.save.saved');
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
          lastRenderedValue = content;
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
      if (header) header.textContent = t('toc.titleWithCount', { count: entries.length });
    } else if (tocNav) {
      const header = tocNav.querySelector('h2');
      if (header)
        header.textContent =
          entries.length > 0 ? t('toc.titleWithCount', { count: entries.length }) : t('toc.title');
    }
  };

  // ── i18n chrome sync ────────────────────────────────────────────────
  const syncLangPickers = (locale: Locale): void => {
    if (langPicker) langPicker.value = locale;
    if (settingsLangPicker) settingsLangPicker.value = locale;
  };

  const applyStaticI18n = (locale: Locale): void => {
    // ribbon
    const ribbonElI18n = document.getElementById('scribe-ribbon') as HTMLElement | null;
    if (ribbonElI18n)
      ribbonElI18n.setAttribute(
        'aria-label',
        t('ribbon.files', locale) + ' / ' + t('ribbon.search', locale),
      );
    const ribbonFilesI18n = document.getElementById('scribe-ribbon-files') as HTMLElement | null;
    if (ribbonFilesI18n) {
      ribbonFilesI18n.setAttribute('aria-label', t('ribbon.files', locale));
      ribbonFilesI18n.title = t('ribbon.files', locale);
    }
    const ribbonSearchI18n = document.getElementById('scribe-ribbon-search') as HTMLElement | null;
    if (ribbonSearchI18n) {
      ribbonSearchI18n.setAttribute('aria-label', t('ribbon.search', locale));
      ribbonSearchI18n.title = t('ribbon.search', locale);
    }
    const ribbonTocI18n = document.getElementById('scribe-ribbon-toc') as HTMLElement | null;
    if (ribbonTocI18n) {
      ribbonTocI18n.setAttribute('aria-label', t('ribbon.outline', locale));
      ribbonTocI18n.title = t('ribbon.outline', locale);
    }
    const ribbonNewI18n = document.getElementById('scribe-ribbon-new') as HTMLElement | null;
    if (ribbonNewI18n) {
      ribbonNewI18n.setAttribute('aria-label', t('ribbon.newFile', locale));
      ribbonNewI18n.title = t('ribbon.newFile', locale);
    }
    const ribbonCollapseI18n = document.getElementById(
      'scribe-ribbon-collapse',
    ) as HTMLElement | null;
    if (ribbonCollapseI18n) {
      const isCollapsed = ribbonEl?.classList.contains('is-collapsed') ?? false;
      const label = isCollapsed ? t('ribbon.expand', locale) : t('ribbon.collapse', locale);
      ribbonCollapseI18n.setAttribute('aria-label', label);
      ribbonCollapseI18n.title = label;
    }
    const ribbonSettingsI18n = document.getElementById(
      'scribe-settings-toggle',
    ) as HTMLElement | null;
    if (ribbonSettingsI18n) {
      ribbonSettingsI18n.setAttribute('aria-label', t('ribbon.settings', locale));
      ribbonSettingsI18n.title = t('ribbon.settings', locale);
    }
    // header
    if (headerEl) headerEl.setAttribute('aria-label', t('header.aria', locale));
    const menuToggleEl = document.getElementById('scribe-menu-toggle') as HTMLElement | null;
    if (menuToggleEl)
      menuToggleEl.setAttribute('aria-label', t('header.menu.toggleExplorer', locale));
    if (settingsToggle)
      settingsToggle.setAttribute('aria-label', t('header.menu.toggleSettings', locale));
    const exportGroup = document.getElementById('scribe-export-group') as HTMLElement | null;
    if (exportGroup) exportGroup.setAttribute('aria-label', t('header.export.group', locale));
    if (exportMdBtn) {
      exportMdBtn.title = t('header.export.md.title', locale);
      exportMdBtn.setAttribute('aria-label', t('header.export.md.title', locale));
    }
    if (exportHtmlBtn) {
      exportHtmlBtn.title = t('header.export.html.title', locale);
      exportHtmlBtn.setAttribute('aria-label', t('header.export.html.title', locale));
    }
    if (exportPdfBtn) {
      exportPdfBtn.title = t('header.export.pdf.title', locale);
      exportPdfBtn.setAttribute('aria-label', t('header.export.pdf.title', locale));
    }
    if (backdrop) backdrop.setAttribute('aria-label', t('header.backdrop.close', locale));
    // toolbar
    if (toolbarEl) toolbarEl.setAttribute('aria-label', t('toolbar.label', locale));
    toolbarGroupEls.forEach((el, idx) => {
      const keys: Array<string> = [
        'toolbar.group.inline',
        'toolbar.group.blocks',
        'toolbar.group.insert',
        'toolbar.group.viewMode',
      ];
      const k = keys[idx] as any;
      if (k) el.setAttribute('aria-label', t(k, locale));
    });
    const toolbarMap: Record<string, string> = {
      bold: 'toolbar.bold',
      italic: 'toolbar.italic',
      code: 'toolbar.code',
      h1: 'toolbar.h1',
      h2: 'toolbar.h2',
      h3: 'toolbar.h3',
      quote: 'toolbar.quote',
      codeBlock: 'toolbar.codeBlock',
      link: 'toolbar.link',
      image: 'toolbar.image',
      table: 'toolbar.table',
      math: 'toolbar.math',
      mathBlock: 'toolbar.mathBlock',
    };
    for (const [action, base] of Object.entries(toolbarMap)) {
      const btn = toolbarEl?.querySelector(
        `button[data-action="${action}"]`,
      ) as HTMLButtonElement | null;
      if (btn) {
        btn.title = t(`${base}.title` as any, locale);
        btn.setAttribute('aria-label', t(`${base}.label` as any, locale));
      }
    }
    // theme pickers
    if (themePicker) {
      themePicker.setAttribute('aria-label', t('toolbar.theme.picker.label', locale));
      themePicker.title = t('toolbar.theme.picker.title', locale);
    }
    if (settingsThemePicker) {
      settingsThemePicker.setAttribute('aria-label', t('settings.markdownTheme.label', locale));
    }
    if (themeToggle) {
      themeToggle.title = t('toolbar.theme.toggle.title', locale);
      themeToggle.setAttribute('aria-label', t('toolbar.theme.toggle.label', locale));
      // keep icon, update text node
      const textNode = Array.from(themeToggle.childNodes).find((n) => n.nodeType === 3);
      if (textNode) textNode.textContent = t('toolbar.theme.toggle.text', locale);
      else themeToggle.textContent = t('toolbar.theme.toggle.text', locale);
    }
    // lang pickers
    if (langPicker) {
      langPicker.setAttribute('aria-label', t('lang.label', locale));
      langPicker.title = t('lang.switcher', locale);
    }
    if (settingsLangPicker) {
      settingsLangPicker.setAttribute('aria-label', t('settings.language.label', locale));
    }
    // explorer / toc nav labels
    if (explorerNav) explorerNav.setAttribute('aria-label', t('explorer.navLabel', locale));
    if (tocNav) tocNav.setAttribute('aria-label', t('toc.navLabel', locale));
    const tocList = document.getElementById('scribe-toc-list') as HTMLElement | null;
    if (tocList) tocList.setAttribute('aria-label', t('toc.listLabel', locale));
    const stageEl = document.getElementById('scribe-stage') as HTMLElement | null;
    if (stageEl) stageEl.setAttribute('aria-label', t('stage.label', locale));
    const canvasEl = document.getElementById('scribe-canvas') as HTMLElement | null;
    if (canvasEl) canvasEl.setAttribute('aria-label', t('stage.canvasLabel', locale));
    const handleEl = document.getElementById('scribe-split-handle') as HTMLElement | null;
    if (handleEl) handleEl.setAttribute('aria-label', t('stage.splitHandle.label', locale));
    if (settingsPanel) {
      settingsPanel.setAttribute('aria-label', t('settings.navLabel', locale));
      const titleEl = document.getElementById('scribe-settings-title') as HTMLElement | null;
      if (titleEl) titleEl.textContent = t('settings.title', locale);
      const navEl = settingsPanel.querySelector('.scribe-settings__nav') as HTMLElement | null;
      if (navEl) navEl.setAttribute('aria-label', t('settings.tabs.navLabel', locale));
      // tab labels
      const tabAppearance = document.getElementById(
        'scribe-settings-tab-appearance',
      ) as HTMLElement | null;
      if (tabAppearance) {
        const lbl = tabAppearance.querySelector('.scribe-settings__label');
        if (lbl) lbl.textContent = t('settings.tabs.appearance', locale);
        tabAppearance.setAttribute('aria-label', t('settings.tabs.appearance', locale));
      }
      const tabEditor = document.getElementById('scribe-settings-tab-editor') as HTMLElement | null;
      if (tabEditor) {
        const lbl = tabEditor.querySelector('.scribe-settings__label');
        if (lbl) lbl.textContent = t('settings.tabs.editor', locale);
        tabEditor.setAttribute('aria-label', t('settings.tabs.editor', locale));
      }
      const tabHotkeys = document.getElementById(
        'scribe-settings-tab-hotkeys',
      ) as HTMLElement | null;
      if (tabHotkeys) {
        const lbl = tabHotkeys.querySelector('.scribe-settings__label');
        if (lbl) lbl.textContent = t('settings.tabs.hotkeys', locale);
        tabHotkeys.setAttribute('aria-label', t('settings.tabs.hotkeys', locale));
      }
      const tabAbout = document.getElementById('scribe-settings-tab-about') as HTMLElement | null;
      if (tabAbout) {
        const lbl = tabAbout.querySelector('.scribe-settings__label');
        if (lbl) lbl.textContent = t('settings.tabs.about', locale);
        tabAbout.setAttribute('aria-label', t('settings.tabs.about', locale));
      }
      // pane titles
      const appearanceTitle = document.getElementById(
        'scribe-settings-appearance-title',
      ) as HTMLElement | null;
      if (appearanceTitle) appearanceTitle.textContent = t('settings.appearance.title', locale);
      const editorTitle = document.getElementById(
        'scribe-settings-editor-title',
      ) as HTMLElement | null;
      if (editorTitle) editorTitle.textContent = t('settings.editor.title', locale);
      const hotkeysTitle = document.getElementById(
        'scribe-settings-hotkeys-title',
      ) as HTMLElement | null;
      if (hotkeysTitle) hotkeysTitle.textContent = t('settings.hotkeys.title', locale);
      const aboutTitle = document.getElementById(
        'scribe-settings-about-title',
      ) as HTMLElement | null;
      if (aboutTitle) aboutTitle.textContent = t('settings.about.title', locale);
      const hotkeysColAction = document.getElementById(
        'scribe-settings-hotkeys-col-action',
      ) as HTMLElement | null;
      if (hotkeysColAction) hotkeysColAction.textContent = t('settings.hotkeys.col.action', locale);
      const hotkeysColShortcut = document.getElementById(
        'scribe-settings-hotkeys-col-shortcut',
      ) as HTMLElement | null;
      if (hotkeysColShortcut)
        hotkeysColShortcut.textContent = t('settings.hotkeys.col.shortcut', locale);
      const hotkeysHint = document.getElementById(
        'scribe-settings-hotkeys-hint',
      ) as HTMLElement | null;
      if (hotkeysHint) hotkeysHint.textContent = t('settings.hotkeys.hint', locale);
      const aboutHybridTitle = document.getElementById(
        'scribe-settings-about-hybrid-title',
      ) as HTMLElement | null;
      if (aboutHybridTitle) aboutHybridTitle.textContent = t('settings.about.hybridTitle', locale);
      const aboutDebugTitle = document.getElementById(
        'scribe-settings-about-debug-title',
      ) as HTMLElement | null;
      if (aboutDebugTitle) aboutDebugTitle.textContent = t('settings.about.debugTitle', locale);
      const aboutExportTitle = document.getElementById(
        'scribe-settings-about-export-title',
      ) as HTMLElement | null;
      if (aboutExportTitle) aboutExportTitle.textContent = t('settings.about.exportTitle', locale);
      // fallback for legacy h2 in dialog
      const fallbackH2s = Array.from(settingsPanel.querySelectorAll('h2'));
      if (!titleEl && fallbackH2s[0]) fallbackH2s[0].textContent = t('settings.title', locale);
    }
    if (settingsCloseBtn) {
      settingsCloseBtn.setAttribute('aria-label', t('settings.close', locale));
      settingsCloseBtn.title = t('settings.close', locale);
    }
    const liveLabel = livePreviewCb?.parentElement as HTMLElement | null;
    if (liveLabel) {
      const input = liveLabel.querySelector('input');
      if (input) {
        liveLabel.childNodes.forEach((n) => {
          if (n.nodeType === 3 && n.textContent?.trim()) {
            n.textContent = ' ' + t('settings.livePreview', locale);
          }
        });
        if (!liveLabel.textContent?.includes(t('settings.livePreview', locale))) {
          liveLabel.appendChild(document.createTextNode(' ' + t('settings.livePreview', locale)));
        }
      }
    }
    const scrollLabel = scrollSyncCb?.parentElement as HTMLElement | null;
    if (scrollLabel) {
      scrollLabel.childNodes.forEach((n) => {
        if (n.nodeType === 3 && n.textContent?.trim()) {
          n.textContent = ' ' + t('settings.scrollSync', locale);
        }
      });
    }
    const focusLabelEl = focusModeCb?.parentElement as HTMLElement | null;
    if (focusLabelEl) {
      focusLabelEl.childNodes.forEach((n) => {
        if (n.nodeType === 3 && n.textContent?.trim()) {
          n.textContent = ' ' + t('settings.focusMode', locale);
        }
      });
    }
    const wysiwygLabelEl = settingsWysiwygCb?.parentElement as HTMLElement | null;
    if (wysiwygLabelEl) {
      wysiwygLabelEl.childNodes.forEach((n) => {
        if (n.nodeType === 3 && n.textContent?.trim()) {
          n.textContent = ' ' + t('settings.wysiwyg', locale);
        }
      });
      if (!wysiwygLabelEl.textContent?.includes(t('settings.wysiwyg', locale))) {
        const hasText = Array.from(wysiwygLabelEl.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent?.trim()?.length ?? 0) > 0,
        );
        if (!hasText)
          wysiwygLabelEl.appendChild(document.createTextNode(' ' + t('settings.wysiwyg', locale)));
      }
    }
    // View mode selects i18n (CTX-0549)
    try {
      const vmSel = document.getElementById('scribe-view-mode') as HTMLSelectElement | null;
      if (vmSel) {
        vmSel.setAttribute('aria-label', t('toolbar.viewMode.select.label', locale));
        vmSel.title = t('toolbar.viewMode.select.title', locale);
        const oR = vmSel.querySelector('option[value="reading"]') as HTMLOptionElement | null;
        const oS = vmSel.querySelector('option[value="source"]') as HTMLOptionElement | null;
        const oL = vmSel.querySelector('option[value="live"]') as HTMLOptionElement | null;
        if (oR) oR.textContent = t('toolbar.viewMode.reading', locale);
        if (oS) oS.textContent = t('toolbar.viewMode.source', locale);
        if (oL) oL.textContent = t('toolbar.viewMode.live', locale);
      }
      const sVmSel = document.getElementById(
        'scribe-settings-view-mode',
      ) as HTMLSelectElement | null;
      if (sVmSel) {
        const oR2 = sVmSel.querySelector('option[value="reading"]') as HTMLOptionElement | null;
        const oS2 = sVmSel.querySelector('option[value="source"]') as HTMLOptionElement | null;
        const oL2 = sVmSel.querySelector('option[value="live"]') as HTMLOptionElement | null;
        if (oR2) oR2.textContent = t('settings.viewMode.reading', locale);
        if (oS2) oS2.textContent = t('settings.viewMode.source', locale);
        if (oL2) oL2.textContent = t('settings.viewMode.live', locale);
        const vmHint = document.getElementById(
          'scribe-settings-viewmode-hint',
        ) as HTMLElement | null;
        if (vmHint) vmHint.textContent = t('settings.viewMode.hint', locale);
      }
    } catch {}
    // markdown theme label in settings
    const mdThemeLabel = settingsPanel?.querySelector(
      'label[for="scribe-settings-theme-picker"]',
    ) as HTMLElement | null;
    if (mdThemeLabel) mdThemeLabel.textContent = t('settings.markdownTheme', locale);
    const langLabel = settingsPanel?.querySelector(
      'label[for="scribe-settings-lang-picker"]',
    ) as HTMLElement | null;
    if (langLabel) langLabel.textContent = t('settings.language.label', locale);
    // hints — id-based for tabbed layout, fallback to index for legacy
    const themeHint = document.getElementById('scribe-settings-theme-hint') as HTMLElement | null;
    if (themeHint) themeHint.textContent = t('settings.hint.applies', locale);
    const langHint = document.getElementById('scribe-settings-lang-hint') as HTMLElement | null;
    if (langHint) langHint.textContent = t('settings.language.hint', locale);
    const editorHint = document.getElementById('scribe-settings-editor-hint') as HTMLElement | null;
    if (editorHint) editorHint.textContent = t('settings.editor.hint', locale);
    const hybridHint = document.getElementById(
      'scribe-settings-about-hybrid',
    ) as HTMLElement | null;
    if (hybridHint) hybridHint.textContent = t('settings.hint.hybrid', locale);
    const debugHint = document.getElementById('scribe-settings-about-debug') as HTMLElement | null;
    if (debugHint) debugHint.textContent = t('settings.hint.debug', locale);
    const exportHint = document.getElementById(
      'scribe-settings-about-export',
    ) as HTMLElement | null;
    if (exportHint) exportHint.textContent = t('settings.export.hint', locale);
    // legacy fallback hints index
    const legacyHints = settingsPanel ? Array.from(settingsPanel.querySelectorAll('.hint')) : [];
    if (!themeHint && legacyHints[0])
      legacyHints[0].textContent = t('settings.hint.applies', locale);
    if (!langHint && legacyHints[1])
      legacyHints[1].textContent = t('settings.language.hint', locale);
    // hotkeys action column i18n — map data-hotkey to toolbar labels
    const hotkeyMap: Record<string, string> = {
      bold: t('toolbar.bold.label', locale),
      italic: t('toolbar.italic.label', locale),
      code: t('toolbar.code.label', locale),
      h1: t('toolbar.h1.label', locale),
      h2: t('toolbar.h2.label', locale),
      h3: t('toolbar.h3.label', locale),
      quote: t('toolbar.quote.label', locale),
      codeBlock: t('toolbar.codeBlock.label', locale),
      link: t('toolbar.link.label', locale),
      image: t('toolbar.image.label', locale),
      table: t('toolbar.table.label', locale),
      math: t('toolbar.math.label', locale),
      undo: t('context.undo', locale),
      redo: t('context.redo', locale),
    };
    settingsPanel?.querySelectorAll<HTMLTableCellElement>('td[data-hotkey]').forEach((td) => {
      const key = td.getAttribute('data-hotkey');
      if (key && hotkeyMap[key]) td.textContent = hotkeyMap[key];
    });
    // explorer heading is rendered via explorer.ts, but fallback static h2 needs update too (before mount)
    const explorerH2 = explorerNav?.querySelector('h2') as HTMLElement | null;
    if (explorerH2 && !explorerNav?.querySelector('button')) {
      // only static fallback; dynamic explorer will handle itself
      explorerH2.textContent = t('explorer.title', locale);
    }
    // toc heading
    const tocH2 = tocNav?.querySelector('h2') as HTMLElement | null;
    if (tocH2) {
      // will be overwritten by updateToc, but set fallback
      if (
        tocH2.textContent === 'Outline' ||
        tocH2.textContent === '大纲' ||
        tocH2.textContent?.startsWith('Outline') ||
        tocH2.textContent?.startsWith('大纲')
      ) {
        // keep count logic in updateToc, just set base
        if (!tocH2.textContent?.includes('(')) tocH2.textContent = t('toc.title', locale);
      }
    }
    // save status
    if (saveStatusEl) {
      const cur = saveStatusEl.textContent?.trim();
      if (
        cur === 'Saved' ||
        cur === '已保存' ||
        cur === t('header.save.saved', 'en') ||
        cur === t('header.save.saved', 'zh-CN')
      ) {
        saveStatusEl.textContent = t('header.save.saved', locale);
      } else if (cur === 'Edited' || cur === '已编辑') {
        saveStatusEl.textContent = t('header.save.edited', locale);
      }
    }
    // wysiwyg/focus toggles already handled in updateWysiwygChrome, but ensure sync
    updateWysiwygChrome(viewMode as any);
    // collapsed buttons aria
    const explorerCollapsedNow = explorerNav?.classList.contains('is-collapsed') ?? false;
    if (toggleExplorerBtn) {
      toggleExplorerBtn.setAttribute(
        'aria-label',
        explorerCollapsedNow
          ? t('header.expand.explorer', locale)
          : t('header.collapse.explorer', locale),
      );
      toggleExplorerBtn.title = explorerCollapsedNow
        ? t('header.expand.explorer', locale)
        : t('header.collapse.explorer', locale);
    }
    const tocCollapsedNow = tocNav?.classList.contains('is-collapsed') ?? false;
    if (toggleTocBtn) {
      toggleTocBtn.setAttribute(
        'aria-label',
        tocCollapsedNow ? t('header.expand.outline', locale) : t('header.collapse.outline', locale),
      );
      toggleTocBtn.title = tocCollapsedNow
        ? t('header.expand.outline', locale)
        : t('header.collapse.outline', locale);
    }
    const contextMenuEl = document.getElementById('scribe-context-menu') as HTMLElement | null;
    if (contextMenuEl) contextMenuEl.setAttribute('aria-label', t('context.menu.aria', locale));
    const statusBarEl = document.getElementById('scribe-statusbar') as HTMLElement | null;
    if (statusBarEl) statusBarEl.setAttribute('aria-label', t('status.aria', locale));
    try {
      updateWordCount();
    } catch {
      // ignore early
    }
    syncLangPickers(locale);
  };

  // initial apply
  syncLangPickers(initialLocale);
  applyStaticI18n(initialLocale);

  // ── Settings tabs (Obsidian-style: Appearance / Editor / Hotkeys / About) ──
  const SETTINGS_TAB_KEY = 'scribe:settings-tab-v1';
  type SettingsTab = 'appearance' | 'editor' | 'hotkeys' | 'about';
  const VALID_TABS: SettingsTab[] = ['appearance', 'editor', 'hotkeys', 'about'];
  const readSettingsTab = (): SettingsTab => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_TAB_KEY) as SettingsTab | null;
      if (raw && (VALID_TABS as string[]).includes(raw)) return raw;
    } catch {
      // ignore
    }
    return 'appearance';
  };
  const writeSettingsTab = (tab: SettingsTab): void => {
    try {
      window.localStorage.setItem(SETTINGS_TAB_KEY, tab);
    } catch {
      // ignore
    }
  };
  const activateSettingsTab = (tab: SettingsTab): void => {
    if (!(VALID_TABS as string[]).includes(tab)) tab = 'appearance';
    for (const btn of settingsTabButtons) {
      const isActive = btn.dataset.tab === tab;
      btn.setAttribute('aria-selected', String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    }
    for (const pane of settingsTabPanes) {
      const paneTab = pane.id.replace('scribe-settings-pane-', '');
      const isActive = paneTab === tab;
      if (isActive) pane.removeAttribute('hidden');
      else pane.setAttribute('hidden', '');
      pane.setAttribute('aria-hidden', String(!isActive));
    }
    writeSettingsTab(tab);
  };
  let activeSettingsTab: SettingsTab = readSettingsTab();
  activateSettingsTab(activeSettingsTab);
  for (const btn of settingsTabButtons) {
    btn.addEventListener('click', () => {
      const tab = (btn.dataset.tab as SettingsTab) ?? 'appearance';
      activeSettingsTab = tab;
      activateSettingsTab(tab);
      btn.focus();
    });
  }
  const settingsNavEl = document.querySelector('.scribe-settings__nav') as HTMLElement | null;
  settingsNavEl?.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.matches('[role="tab"]')) return;
    const tabs = settingsTabButtons;
    const idx = tabs.indexOf(target as HTMLButtonElement);
    if (idx === -1) return;
    let nextIdx: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      nextIdx = (idx + 1) % tabs.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIdx = (idx - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = tabs.length - 1;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const tab = (target as HTMLElement).dataset.tab as SettingsTab;
      if (tab) {
        activeSettingsTab = tab;
        activateSettingsTab(tab);
      }
      return;
    }
    if (nextIdx !== null) {
      const nextTab = (tabs[nextIdx].dataset.tab as SettingsTab) ?? 'appearance';
      activeSettingsTab = nextTab;
      activateSettingsTab(nextTab);
      tabs[nextIdx].focus();
    }
  });

  let livePreview = livePreviewCb?.checked ?? true;
  let scrollSyncEnabled = scrollSyncCb?.checked ?? true;

  livePreviewCb?.addEventListener('change', () => {
    livePreview = livePreviewCb.checked;
    if (livePreview) {
      const content = textArea.value;
      lastRenderedValue = content;
      markdown.setContent(content);
      previewScroll.updateContentSize();
      updateToc();
      scene.markDirty();
    }
  });
  scrollSyncCb?.addEventListener('change', () => {
    scrollSyncEnabled = scrollSyncCb.checked;
  });

  // Language pickers
  langPicker?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as Locale;
    if (v === 'en' || v === 'zh-CN') {
      setLocale(v);
    }
  });
  settingsLangPicker?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as Locale;
    if (v === 'en' || v === 'zh-CN') {
      setLocale(v);
    }
  });
  subscribe((locale) => {
    document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
    applyStaticI18n(locale);
    // re-render explorer and toc with new language
    try {
      // explorer re-render via mountExplorer's internal rerender: trigger by dispatching custom event
      // simplest: find explorer nav and force updateChrome + explorer rerender if possible
      // Since mountExplorer returns void, we manually trigger a re-render by calling updateChrome and updateToc
      // and for explorer we dispatch a locale event that explorer could listen to, but easier: re-call mount logic
      // We stored no handle, so just update header title manually and rely on next interaction
      // Instead we re-render explorer by temporarily triggering a fake update
      if (explorerNav) {
        // Force re-render by calling render via a synthetic storage event
        // We'll just re-apply explorer file list language by updating title span directly
        const expTitle = explorerNav.querySelector('div > span') as HTMLElement | null;
        if (expTitle) expTitle.textContent = t('explorer.title', locale);
        const addBtn = explorerNav.querySelector('button[aria-label]') as HTMLElement | null;
        if (addBtn) {
          addBtn.title = t('explorer.newFile.title', locale);
          addBtn.setAttribute('aria-label', t('explorer.newFile.label', locale));
        }
      }
    } catch {
      // ignore
    }
    updateChrome();
    updateToc();
    updateWordCount();
    // Re-render preview/scene to ensure any language-dependent overlays repaint
    scene.markDirty();
  });

  const renderMarkdownImmediate = (content: string): void => {
    if (!livePreview) return;
    lastRenderedValue = content;
    markdown.setContent(content);
    previewScroll.updateContentSize();
    updateChrome();
    updateToc();
    updateWordCount();
    if (scrollSyncEnabled) syncEditorToPreview();
    scene.markDirty();
  };

  // Preview rebuild is heavy (Markdown 500+ lines + TOC DOM). 80ms thrashes
  // while typing fast. Bump to 120ms to coalesce bursts and keep 60fps.
  const debouncedRender = debounce((content: unknown) => {
    renderMarkdownImmediate(String(content));
    if (saveStatusEl) saveStatusEl.textContent = t('header.save.saved');
    persistDocument(model);
  }, 120) as (c: string) => void;

  // --- Sync scroll: bidirectional, debounced, no loop ---
  // 80ms guard made wheel feel dead (every 5th tick only). 32ms keeps loop
  // prevention but lets 30Hz wheel through. Preview→editor bumped to 50ms
  // to reduce wheel thrash at 60-120Hz while keeping editor→preview snappy.
  const guard = new SyncGuard(50);

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

  // ── Inline WYSIWYG (Obsidian Live Preview) helpers — per-block source/render ──
  const producesInlineEntity = (token: { type: string; text?: string }): boolean => {
    switch (token.type) {
      case 'space':
        return false;
      case 'html': {
        const text = (token as unknown as { text: string }).text?.toLowerCase() ?? '';
        return text.includes('<svg') && text.includes('</svg>');
      }
      case 'heading':
      case 'paragraph':
      case 'code':
      case 'blockquote':
      case 'list':
      case 'table':
      case 'hr':
      case 'footnoteDef':
      case 'container':
        return true;
      case 'blockMath':
        // Display math $$...$$ is rendered as MathBlock preview; never overlay source
        // (screenshot leak #scribe-inline-source showed $$/x^2/$$ floating over "Hello Scribe")
        return false;
      default:
        return typeof (token as unknown as { text?: string }).text === 'string';
    }
  };

  type SourceBlock = {
    index: number;
    start: number;
    end: number;
    raw: string;
    token: unknown;
  };

  const getSourceBlocks = (source: string): SourceBlock[] => {
    let tokens: unknown[] = [];
    try {
      tokens = marked.lexer(source) as unknown[];
    } catch {
      return [];
    }
    const blocks: SourceBlock[] = [];
    let pos = 0;
    let blockIdx = 0;
    for (const tok of tokens as Array<{ type: string; raw?: string }>) {
      if (!producesInlineEntity(tok as { type: string; text?: string })) continue;
      const raw = typeof tok.raw === 'string' ? tok.raw : '';
      if (!raw) continue;
      let idx = source.indexOf(raw, pos);
      if (idx === -1) {
        // fallback: search from start then clamp to pos
        idx = source.indexOf(raw);
        if (idx === -1) idx = pos;
        if (idx < pos) idx = pos;
      }
      const end = idx + raw.length;
      blocks.push({ index: blockIdx++, start: idx, end, raw, token: tok });
      pos = end;
    }
    return blocks;
  };

  const findActiveBlockIdx = (
    selectionStart: number,
    selectionEnd: number,
    blocks: SourceBlock[],
  ): number => {
    if (blocks.length === 0) return -1;
    const cursor = selectionStart;
    const hasSelection = selectionEnd !== selectionStart;
    // If selection spans, pick first overlapped block; selectionEnd exclusive
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const overlaps = hasSelection
        ? cursor < b.end && selectionEnd > b.start
        : cursor >= b.start && cursor < b.end;
      if (overlaps) return i;
    }
    // Cursor at very end of doc -> last block
    if (cursor >= blocks[blocks.length - 1].end) return blocks.length - 1;
    // Between blocks (e.g. blank line): return -1 to show all rendered
    return -1;
  };

  const getBlockVisualBox = (
    blockIdx: number,
    blocks: SourceBlock[],
  ): { y: number; height: number } | null => {
    if (blockIdx < 0 || blockIdx >= blocks.length) return null;
    // Prefer line-box proportional mapping to avoid parallax drift when virtualized
    // (markdown.content.children is windowed when virtualized, so indices drift —
    // screenshot showed math overlay covering "Hello Scribe" due to child[blockIdx] mismatch).
    const boxes = getMarkdownLineBoxes();
    if (boxes.length > 0) {
      if (blocks.length <= 1) {
        const b = boxes[0];
        return b ? { y: b.y, height: b.height } : null;
      }
      // Block-height-aware: map source start/end lines to preview boxes for accurate y/height
      try {
        const source = textArea.value ?? '';
        const block = blocks[blockIdx];
        if (block) {
          const sourceLines = source.split('\n');
          const lineCount = sourceLines.length;
          const startLine = source.slice(0, block.start).split('\n').length - 1;
          const endSlice = source.slice(0, block.end).replace(/\n+$/, '');
          const endLine = endSlice.split('\n').length - 1;
          if (lineCount > 1 && boxes.length > 1) {
            const startRatio = Math.min(1, Math.max(0, startLine / Math.max(1, lineCount - 1)));
            const endRatio = Math.min(1, Math.max(0, endLine / Math.max(1, lineCount - 1)));
            const startIdx = Math.min(boxes.length - 1, Math.floor(startRatio * boxes.length));
            const endIdx = Math.min(boxes.length - 1, Math.floor(endRatio * boxes.length));
            const sBox = boxes[startIdx];
            const eBox = boxes[endIdx];
            if (sBox && eBox) {
              const y = sBox.y;
              const height = eBox.y + eBox.height - sBox.y;
              if (height > 0) return { y, height };
            }
          }
        }
      } catch {
        // fallback to blockIdx ratio
      }
      const ratio = Math.min(1, Math.max(0, blockIdx / Math.max(1, blocks.length - 1)));
      const targetIdx = Math.min(boxes.length - 1, Math.floor(ratio * boxes.length));
      const box = boxes[targetIdx];
      return box ? { y: box.y, height: box.height } : null;
    }
    // Fallback to child entity when no line boxes (initial render before layout)
    try {
      const content = markdown.content as unknown as {
        children?: Array<{ y?: number; height?: number }>;
      };
      const child = content?.children?.[blockIdx];
      if (child && typeof child.y === 'number' && typeof child.height === 'number') {
        if (child.height > 0) return { y: child.y ?? 0, height: child.height };
      }
    } catch {
      // ignore
    }
    return null;
  };

  // ── Inline WYSIWYG state (hoisted for layout) ──
  let lastInlineActiveIdx = -1;
  let inlineRaf = 0;
  let renderInlineWysiwyg: () => void = () => {};
  let queueInlineWysiwyg: () => void = () => {};

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

  const debouncedEditorSync = debounce(() => syncEditorToPreview(), 12) as () => void;
  const debouncedPreviewSync = debounce(() => syncPreviewToEditor(), 12) as () => void;
  const throttledPreviewWheelSync = throttleRaf(() => syncPreviewToEditor()) as () => void;

  textArea.on('scroll', () => {
    if (!scrollSyncEnabled) return;
    // Don't fight native textarea drag-selection: when user drags to select text,
    // the selection is still changing and debounced sync would move scrollTop underneath.
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const hasNativeSelection = !!sel && sel.rangeCount > 0 && !sel.isCollapsed;
    // If native selection is active and originates from textarea region, pause sync
    // (check a11yRoot contains selection anchor)
    if (hasNativeSelection) {
      const anchor = sel?.anchorNode as Node | null;
      const inA11yTextarea =
        anchor &&
        (anchor instanceof Element
          ? (anchor as Element).closest?.('[data-vecto-a11y-root], #scribe-a11y-root')
          : (anchor.parentElement?.closest?.('[data-vecto-a11y-root], #scribe-a11y-root') ?? null));
      // If selection is inside textarea's projection, don't auto-sync scroll during drag
      const tau = document.querySelector('[data-vecto-a11y-root]');
      void tau;
      void inA11yTextarea;
      // Simplistic: if any non-collapsed selection exists, throttle preview sync a bit
      // We still sync editor→preview (not preview→editor) so not all blocked
    }
    debouncedEditorSync();
  });
  previewScroll.on('wheel', () => {
    if (!scrollSyncEnabled) return;
    if (viewMode !== 'source') return;
    throttledPreviewWheelSync();
  });
  // Fix: ScrollView only scrolls when pointer over preview content [data-vecto-content]; blank gutters don't scroll.
  // Stage wheel listener forwards wheel delta to previewScroll regardless of pointer position when preview is active pane,
  // and ensures scrollbar visible even when hovering blank area. Also bypasses isValidStageSize guard that blocks scroll at small sizes.
  stage.addEventListener(
    'wheel',
    (ev: WheelEvent) => {
      // Ignore if over explorer/toc/backdrop
      const target = ev.target as HTMLElement | null;
      if (target?.closest?.('#scribe-explorer, #scribe-toc, #scribe-backdrop, #scribe-settings'))
        return;
      // Don't double-handle when wheel already over preview content (ScrollView will handle there)
      // But we still want gutter areas: if wheel over stage and preview has scrollable content, forward delta.
      // In wysiwyg, any wheel over stage should scroll preview
      // In source split, wheel over preview pane (including gutters) scrolls preview; over editor pane scrolls editor.
      const rect = stage.getBoundingClientRect();
      const xInStage = ev.clientX - rect.left;
      const sW = stage.clientWidth;
      const sH = stage.clientHeight;
      // Allow small sizes: don't gate on isValidStageSize so scroll works even when stage reports tiny transient
      // Compute editor pane width for split detection
      const avail = Math.max(320, sW);
      const editorW = Math.round((avail - GAP - HANDLE_W) * splitRatio);
      const isOverPreviewPane = viewMode !== 'source' ? true : xInStage >= editorW + GAP / 2;
      const isOverEditorPane = !isOverPreviewPane && viewMode !== 'source';
      if (isOverPreviewPane) {
        const curTop = -(previewScroll as unknown as { content: { y: number } }).content.y || 0;
        const contentH =
          (previewScroll as unknown as { content: { height: number } }).content.height ||
          markdown.height ||
          0;
        const maxScroll = Math.max(0, contentH - previewScroll.height);
        if (maxScroll <= 0) return;
        // Only handle if not already handled by ScrollView's own projection wheel
        // If pointer is over [data-vecto-content], ScrollView already scrolls; but forwarding again would double.
        // Detect via data-vecto-content ancestor: if present, let ScrollView own it and just sync preview->editor after.
        const overContent = !!target?.closest?.('[data-vecto-content]');
        if (overContent) return;
        const delta = ev.deltaY;
        if (Math.abs(delta) < 0.5) return;
        const next = Math.max(0, Math.min(maxScroll, curTop + delta));
        if (next !== curTop) {
          ev.preventDefault();
          previewScroll.scrollTo(next);
          scene.markDirty();
          updateScrollbars();
        }
      } else if (isOverEditorPane) {
        const anyTA2 = textArea as unknown as {
          scrollTop: number;
          height: number;
          padding: number;
          lineHeightFactor: number;
          font: string;
        };
        const lh2 = (() => {
          const m = /([0-9.]+)px/.exec(anyTA2.font);
          const fs = m ? Number.parseFloat(m[1]) : 14;
          return fs * (anyTA2.lineHeightFactor ?? 1.6);
        })();
        const lc2 = (() => {
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
        const ch2 = lc2 * lh2 + 2 * anyTA2.padding;
        const max2 = Math.max(0, ch2 - anyTA2.height);
        if (max2 <= 0) return;
        const overTAContent =
          !!target?.closest?.('[data-vecto-content]') || !!target?.closest?.('textarea');
        if (overTAContent) return;
        const delta2 = ev.deltaY;
        if (Math.abs(delta2) < 0.5) return;
        const cur2 = anyTA2.scrollTop ?? 0;
        const next2 = Math.max(0, Math.min(max2, cur2 + delta2));
        if (next2 !== cur2) {
          ev.preventDefault();
          (textArea as unknown as { scrollTop: number }).scrollTop = next2;
          const mirror = getMirrorTextarea();
          if (mirror) (mirror as unknown as { scrollTop: number }).scrollTop = next2;
          scene.markDirty();
          updateScrollbars();
        }
      }
      void sH;
    },
    { passive: false },
  );
  // pointermove-driven preview→editor sync was too aggressive: it fired on every mouse move
  // over preview, even while dragging to SELECT text, causing TextArea scrollTop to be
  // recomputed mid-drag and the selection to visibly jump. Gate on actual drag-scroll
  // (when ScrollView is dragging) and on absence of a live text selection.
  let previewDragging = false;
  previewScroll.on('pointerdown', () => {
    previewDragging = true;
  });
  const endPreviewDrag = (): void => {
    previewDragging = false;
  };
  previewScroll.on('pointerup', endPreviewDrag);
  previewScroll.on('pointerleave', endPreviewDrag);
  previewScroll.on('pointercancel', endPreviewDrag);
  previewScroll.on('pointermove', () => {
    if (!scrollSyncEnabled) return;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    const hasSelection = !!sel && sel.rangeCount > 0 && !sel.isCollapsed;
    if (hasSelection) return;
    const internalDragging = (previewScroll as unknown as { dragging?: boolean }).dragging;
    const isDragging = internalDragging ?? previewDragging;
    if (!isDragging) return;
    debouncedPreviewSync();
  });

  // Resize + split layout — DPR-aware: delegates backing-store to Scene.resize
  // (CanvasRenderer.resize: Math.round(css*dpr) max(1), NaN/Infinity→1) and guards
  // 0-height transient from iOS Safari URL-bar collapse.
  // Centered reading column (Obsidian/Typora): max 860, balanced gutters, mobile responsive.
  // ── Visible overlay scrollbars — 8px, always visible (StackEdit/Obsidian) ──
  // Flush to stage right edge (x+w-8 aligned to stage right edge, not x+w-10 inset). Track spans full height.
  const updatePreviewScrollbar = (): void => {
    if (!scrollbarPreviewEl || !scrollbarPreviewThumb) return;
    const viewportHeight = previewScroll.height;
    const contentHeight =
      (previewScroll as unknown as { content: { height: number } }).content.height ||
      markdown.height ||
      0;
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    if (maxScroll <= 0) {
      scrollbarPreviewEl.hidden = true;
      return;
    }
    scrollbarPreviewEl.hidden = false;
    // x+w-8 aligned to stage right edge: stage.clientWidth - 8 (was x+w-10 inset 10px inside preview)
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const scrollTop = -(previewScroll as unknown as { content: { y: number } }).content.y || 0;
    const trackTop = 0;
    const trackHeight = Math.round(stageH);
    const trackLeft = Math.round(stageW - 8);
    scrollbarPreviewEl.style.left = `${trackLeft}px`;
    scrollbarPreviewEl.style.top = `${trackTop}px`;
    scrollbarPreviewEl.style.height = `${trackHeight}px`;
    scrollbarPreviewEl.style.width = '8px';
    const thumbMin = 24;
    const thumbHeight = Math.max(
      thumbMin,
      Math.round((viewportHeight * viewportHeight) / Math.max(1, contentHeight)),
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * maxThumbTop) : 0;
    scrollbarPreviewThumb.style.height = `${thumbHeight}px`;
    scrollbarPreviewThumb.style.top = `${thumbTop}px`;
  };

  const updateEditorScrollbar = (): void => {
    if (!scrollbarEditorEl || !scrollbarEditorThumb) return;
    if (viewMode !== 'source') {
      scrollbarEditorEl.hidden = true;
      return;
    }
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
    const viewportHeight = anyTA.height - 2 * anyTA.padding;
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
    const contentHeight = lineCount * lh + 2 * anyTA.padding;
    const maxScroll = Math.max(0, contentHeight - anyTA.height);
    if (maxScroll <= 0 || viewportHeight <= 0) {
      scrollbarEditorEl.hidden = true;
      return;
    }
    scrollbarEditorEl.hidden = false;
    // x+w-8 aligned to pane right edge (was x+w-10 inset). For split pane, flush to editor pane edge; width 8, full height.
    const stageW = stage.clientWidth;
    const availW = Math.max(320, stageW);
    const editorPaneW = Math.round((availW - GAP - HANDLE_W) * splitRatio);
    const stageH = stage.clientHeight;
    const trackTop = 0;
    const trackHeight = Math.round(stageH);
    const trackLeft = Math.round(editorPaneW - 8);
    scrollbarEditorEl.style.left = `${trackLeft}px`;
    scrollbarEditorEl.style.top = `${trackTop}px`;
    scrollbarEditorEl.style.height = `${trackHeight}px`;
    scrollbarEditorEl.style.width = '8px';
    const scrollTop = anyTA.scrollTop ?? 0;
    const thumbMin = 24;
    const thumbHeight = Math.max(
      thumbMin,
      Math.round((viewportHeight * viewportHeight) / Math.max(1, contentHeight)),
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * maxThumbTop) : 0;
    scrollbarEditorThumb.style.height = `${thumbHeight}px`;
    scrollbarEditorThumb.style.top = `${thumbTop}px`;
  };

  const updateScrollbars = (): void => {
    updatePreviewScrollbar();
    updateEditorScrollbar();
  };

  const layout = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!isValidStageSize(w, h)) return;
    scene.resize(w, h);
    void markdownMaxWidth(w);

    const availW = Math.max(320, w);
    const availH = Math.max(200, h);
    const paneH = availH - 2 * OUTER_PAD;

    // Responsive gutter matches CSS --scribe-centered-gutter (12/16/20/24)
    const responsiveGutter = (() => {
      if (availW <= 390) return 12;
      if (availW <= 640) return 16;
      if (availW <= 1024) return 20;
      return 24;
    })();
    const gutter = Math.max(CENTERED_GUTTER_MIN, responsiveGutter);

    if (viewMode !== 'source') {
      // Obsidian: live and reading share centered single surface (max 860, balanced gutters); reading is preview-only
      textArea.width = 1;
      textArea.height = 1;
      textArea.x = -10000;
      textArea.y = -10000;
      // Obsidian/Typora centered: cap width, gutters grow equally on wide screens,
      // shrink to responsive gutter min on mobile (390px => 366 width, 12px gutters)
      const idealW = Math.min(CENTERED_MAX_WIDTH, Math.max(320, availW - 2 * gutter));
      const centeredX = Math.max(gutter, Math.round((availW - idealW) / 2));
      previewScroll.width = idealW;
      previewScroll.height = paneH;
      previewScroll.x = centeredX;
      previewScroll.y = OUTER_PAD;
      markdown.setMaxWidth(Math.max(200, idealW - MARKDOWN_INNER_PAD));
      if (handle) handle.style.display = 'none';
      previewScroll.updateContentSize();
      scene.markDirty();
      try {
        queueInlineWysiwyg();
      } catch {
        // not yet initialized on first layout
      }
      updateScrollbars();
      return;
    }

    // Source split: each pane centers its content with same max, balanced gutters.
    // Keeps DPR/mobile: on narrow (390) panes fill with responsive gutters; on wide
    // (2560 collapsed) gutters expand to center 860 column inside each pane.
    const editorW = Math.round((availW - GAP - HANDLE_W) * splitRatio);
    const previewW = Math.max(120, availW - editorW - GAP - HANDLE_W);

    const editorContentW = centeredPaneWidth(editorW, gutter, CENTERED_MAX_WIDTH);
    const editorX = centeredPaneX(editorW, editorContentW);
    textArea.width = editorContentW;
    textArea.height = paneH;
    textArea.x = editorX;
    textArea.y = OUTER_PAD;

    const previewContentW = centeredPaneWidth(previewW, gutter, CENTERED_MAX_WIDTH);
    const previewGutter = centeredPaneX(previewW, previewContentW);
    previewScroll.width = previewContentW;
    previewScroll.height = paneH;
    previewScroll.x = editorW + GAP + HANDLE_W + previewGutter;
    previewScroll.y = OUTER_PAD;

    markdown.setMaxWidth(Math.max(200, previewContentW - MARKDOWN_INNER_PAD));

    if (handle) {
      const handleX = editorW + GAP;
      handle.style.left = `${handleX}px`;
      handle.style.display = availW < 600 ? 'none' : 'flex';
    }

    previewScroll.updateContentSize();
    scene.markDirty();
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore early
    }
    updateScrollbars();
  };

  const observer = new ResizeObserver(layout);
  observer.observe(stage);
  layout();
  // Re-apply WYSIWYG chrome now that layout has measured — ensures handle visibility + preview width are correct
  updateWysiwygChrome(viewMode);
  updateScrollbars();
  updateWordCount();

  // ── Scrollbar live sync (rAF loop + scroll listeners) ────────────────────
  let scrollbarRaf = 0;
  const loopScrollbars = (): void => {
    scrollbarRaf = requestAnimationFrame(() => {
      updateScrollbars();
      loopScrollbars();
    });
  };
  loopScrollbars();
  // Also nudge on scroll/wheel for immediate feedback before next rAF
  textArea.on('scroll', () => {
    updateScrollbars();
  });
  previewScroll.on('wheel', () => {
    // next frame will also update, but immediate for thumb snap
    requestAnimationFrame(updateScrollbars);
  });
  // Watch mirror textarea scroll as well (a11y projection owns it)
  const mirrorForScrollbar = getMirrorTextarea();
  mirrorForScrollbar?.addEventListener('scroll', updateScrollbars);
  // Drag thumb → scroll
  const bindScrollbarDrag = (
    thumb: HTMLElement | null,
    track: HTMLElement | null,
    getMetrics: () => {
      viewportHeight: number;
      contentHeight: number;
      maxScroll: number;
      scrollTop: number;
    },
    setScrollTop: (v: number) => void,
  ): void => {
    if (!thumb || !track) return;
    let dragging = false;
    let startY = 0;
    let startScroll = 0;
    let maxScrollCache = 0;
    let maxThumbTopCache = 0;
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const deltaScroll = maxThumbTopCache > 0 ? (dy / maxThumbTopCache) * maxScrollCache : 0;
      const next = Math.max(0, Math.min(maxScrollCache, startScroll + deltaScroll));
      setScrollTop(next);
      updateScrollbars();
      scene.markDirty();
    };
    const onUp = (): void => {
      if (!dragging) return;
      dragging = false;
      thumb.releasePointerCapture?.(0);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      thumb.style.cursor = 'pointer';
    };
    thumb.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      const m = getMetrics();
      if (m.maxScroll <= 0) return;
      dragging = true;
      startY = e.clientY;
      startScroll = m.scrollTop;
      maxScrollCache = m.maxScroll;
      const thumbH = Number.parseInt(thumb.style.height, 10) || 24;
      maxThumbTopCache = Math.max(0, m.viewportHeight - thumbH);
      thumb.setPointerCapture?.(e.pointerId);
      thumb.style.cursor = 'grabbing';
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    // Track click → jump (like native scrollbar page jump)
    track.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.target === thumb) return;
      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const m = getMetrics();
      if (m.maxScroll <= 0) return;
      const thumbH = Number.parseInt(thumb.style.height, 10) || 24;
      const maxThumbTop = Math.max(0, m.viewportHeight - thumbH);
      const ratio = maxThumbTop > 0 ? (clickY - thumbH / 2) / maxThumbTop : 0;
      const clamped = Math.max(0, Math.min(1, ratio));
      const next = Math.round(clamped * m.maxScroll);
      setScrollTop(next);
      updateScrollbars();
      scene.markDirty();
    });
  };
  bindScrollbarDrag(
    scrollbarPreviewThumb,
    scrollbarPreviewEl,
    () => {
      const viewportHeight = previewScroll.height;
      const contentHeight =
        (previewScroll as unknown as { content: { height: number } }).content.height ||
        markdown.height ||
        0;
      const maxScroll = Math.max(0, contentHeight - viewportHeight);
      const scrollTop = -(previewScroll as unknown as { content: { y: number } }).content.y || 0;
      return { viewportHeight, contentHeight, maxScroll, scrollTop };
    },
    (v: number) => previewScroll.scrollTo(v),
  );
  bindScrollbarDrag(
    scrollbarEditorThumb,
    scrollbarEditorEl,
    () => {
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
      const viewportHeight = anyTA.height - 2 * anyTA.padding;
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
      const contentHeight = lineCount * lh + 2 * anyTA.padding;
      const maxScroll = Math.max(0, contentHeight - anyTA.height);
      const scrollTop = anyTA.scrollTop ?? 0;
      return { viewportHeight, contentHeight, maxScroll, scrollTop };
    },
    (v: number) => {
      (textArea as unknown as { scrollTop: number }).scrollTop = v;
      const mirror = getMirrorTextarea();
      if (mirror) (mirror as unknown as { scrollTop: number }).scrollTop = v;
      scene.markDirty();
    },
  );
  // Ensure scrollbar visibility reacts to theme/layout changes
  void scrollbarRaf;
  // Selection change also updates status bar right side (selected chars)
  document.addEventListener('selectionchange', () => {
    const active = document.activeElement as HTMLElement | null;
    if (
      active?.tagName === 'TEXTAREA' ||
      !!active?.closest('[data-vecto-a11y-root], #scribe-a11y-root') ||
      wordCountEl
    ) {
      // Throttle: word count left is stable, but right side (selection length) changes often
      updateWordCount();
    }
  });
  // Watch mirror scroll via polling — mirrorOwnsScroll owns TextArea scrollTop, so we poll to keep thumb in sync
  // (rAF loop already does, but listen to native scroll for instant)
  const scrollbarMirror = getMirrorTextarea();
  scrollbarMirror?.addEventListener('scroll', updateScrollbars);
  // Expose for e2e/debug
  (window as unknown as { __scribeUpdateScrollbars: () => void }).__scribeUpdateScrollbars =
    updateScrollbars;
  (
    window as unknown as {
      __scribeUpdateWordCount: () => void;
      __scribeComputeWordStats: (v: string) => {
        chars: number;
        words: number;
        lines: number;
      };
    }
  ).__scribeUpdateWordCount = updateWordCount;
  (
    window as unknown as {
      __scribeComputeWordStats: (v: string) => {
        chars: number;
        words: number;
        lines: number;
      };
    }
  ).__scribeComputeWordStats = computeWordStats;

  // ── WYSIWYG toggle wiring (Typora single surface) ─────────────────────
  const applyViewMode = (next: ViewMode): void => {
    viewMode = next;
    writeViewMode(next);
    updateViewModeChrome(next);
    layout();
    // In live, preview is the editing surface — focus hidden source for typing
    // Mirror is offscreen (TextArea at -10000) but must stay focused for input -> debouncedRender.
    // Focus may be lost if button retains focus or if a11y textarea not yet projected (rAF timing).
    if (next === 'live') {
      const tryFocusMirror = (attempts = 0): void => {
        const mirror = getMirrorTextarea();
        if (mirror) {
          mirror.focus();
          // Ensure selection preserved at current caret (focusAtLine may have moved)
          try {
            const s = textArea.selectionStart ?? 0;
            const e = textArea.selectionEnd ?? s;
            if (mirror.selectionStart !== s || mirror.selectionEnd !== e) {
              mirror.selectionStart = s;
              mirror.selectionEnd = e;
            }
          } catch {
            // ignore
          }
        } else if (attempts < 5) {
          requestAnimationFrame(() => tryFocusMirror(attempts + 1));
        }
      };
      tryFocusMirror();
      // Fallback timer for browsers that defer a11y projection
      window.setTimeout(() => tryFocusMirror(), 50);
      window.setTimeout(() => tryFocusMirror(), 200);
    } else if (next === 'reading') {
      // Reading: preview only, disable editing overlay, blur hidden textarea to prevent stray input
      try {
        const mirror = getMirrorTextarea();
        if (mirror && document.activeElement === mirror) (mirror as HTMLElement).blur();
      } catch {}
    }
    scene.markDirty();
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore
    }
    try {
      queueFocusHighlight();
    } catch {
      // ignore
    }
  };

  wysiwygToggleBtn?.addEventListener('click', () => {
    applyViewMode(viewMode === 'source' ? 'live' : 'source');
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
  settingsWysiwygCb?.addEventListener('change', () => {
    const next: ViewMode = settingsWysiwygCb.checked ? 'live' : 'source';
    applyViewMode(next);
  });
  // New 3-state view mode selects (toolbar + settings)
  viewModeSelect?.addEventListener('change', () => {
    const v = (viewModeSelect.value as ViewMode) ?? 'source';
    if (v === 'live' || v === 'reading' || v === 'source') applyViewMode(v);
  });
  settingsViewModeSelect?.addEventListener('change', () => {
    const v = (settingsViewModeSelect.value as ViewMode) ?? 'source';
    if (v === 'live' || v === 'reading' || v === 'source') applyViewMode(v);
  });
  // Settings inline formatting buttons -> toolbar actions (when not in reading)
  document
    .querySelectorAll<HTMLButtonElement>('.scribe-settings__inline-btn[data-action]')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        if ((document.documentElement.getAttribute('data-view-mode') as string) === 'reading')
          return;
        const action = btn.getAttribute('data-action') as string | null;
        if (!action) return;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as unknown as { __scribeApplyAction?: (a: any) => void }).__scribeApplyAction?.(
            action as any,
          );
        } catch {}
      });
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
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore
    }
    if (viewMode === 'live') {
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

  // ── Preview interaction — task toggle, link, WYSIWYG focus (left-drag aware) ──
  let lastPointerDownAt = 0;
  let lastPointerDownX = 0;
  let lastPointerDownY = 0;
  const DRAG_THRESHOLD_PX = 6;
  stage.addEventListener('pointerdown', (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    lastPointerDownAt = Date.now();
    lastPointerDownX = ev.clientX;
    lastPointerDownY = ev.clientY;
  });
  // Scroll while selecting: when dragging a preview text selection near viewport edge, auto-scroll preview
  stage.addEventListener('pointermove', (ev: PointerEvent) => {
    // Only during an active native preview selection drag
    const contentProj = (
      scene as unknown as {
        _contentProjection?: { blankRegionDragActive?: boolean };
      }
    )._contentProjection;
    const isPreviewDrag = !!contentProj?.blankRegionDragActive;
    // Fallback: if any non-collapsed preview selection exists, treat as drag
    let isSelecting = isPreviewDrag;
    if (!isSelecting) {
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const txt = sel.toString();
          if (txt.length > 0) {
            const anchor = sel.anchorNode as Node | null;
            const el = (
              anchor instanceof Element ? anchor : (anchor as Node)?.parentElement
            ) as Element | null;
            if (el?.closest?.('[data-vecto-content]')) isSelecting = true;
          }
        }
      } catch {
        // ignore
      }
    }
    if (!isSelecting) return;
    const rect = stage.getBoundingClientRect();
    const previewTop = (previewScroll as unknown as { y: number }).y ?? OUTER_PAD;
    const previewHeight = (previewScroll as unknown as { height: number }).height ?? 400;
    const yInStage = ev.clientY - rect.top;
    // Only when pointer is over preview viewport (or very close)
    if (yInStage < previewTop - 20 || yInStage > previewTop + previewHeight + 20) return;
    const edge = 48;
    const scrollTop = -(previewScroll as unknown as { content: { y: number } }).content.y || 0;
    const maxScroll = Math.max(
      0,
      ((previewScroll as unknown as { content: { height: number } }).content.height || 0) -
        previewHeight,
    );
    let delta = 0;
    if (yInStage < previewTop + edge) {
      const ratioUp = Math.min(1, Math.max(0, (previewTop + edge - yInStage) / edge));
      delta = -Math.round(8 + ratioUp * 24); // scroll up, faster near edge
    } else if (yInStage > previewTop + previewHeight - edge) {
      const ratioDown = Math.min(
        1,
        Math.max(0, (yInStage - (previewTop + previewHeight - edge)) / edge),
      );
      delta = Math.round(8 + ratioDown * 24); // scroll down
    }
    if (delta !== 0) {
      const next = Math.max(0, Math.min(maxScroll, scrollTop + delta));
      if (next !== scrollTop) {
        previewScroll.scrollTo(next);
        scene.markDirty();
      }
    }
    void lastPointerDownAt;
  });
  // Capture task clicks early (both Source and WYSIWYG) before generic focus logic
  stage.addEventListener(
    'click',
    (ev: MouseEvent) => {
      // Only left button
      if ((ev as MouseEvent).button !== 0) return;
      // Ignore UI chrome clicks
      const target = ev.target as HTMLElement | null;
      if (
        target?.closest(
          '#scribe-split-handle, #scribe-backdrop, button, a, input, select, textarea',
        )
      ) {
        if (!target.closest('#scribe-stage')) return;
        if (
          target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT'
        )
          return;
      }
      // Double/triple click → word/line selection: let native selection stand
      if ((ev as MouseEvent).detail >= 2) return;
      // Drag threshold: if pointer moved > threshold, this was a drag-selection not a click
      const dx = Math.abs(ev.clientX - lastPointerDownX);
      const dy = Math.abs(ev.clientY - lastPointerDownY);
      if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) return;
      // If a live non-collapsed selection exists in preview, don't collapse it
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const txt = sel.toString();
          if (txt.length > 0) {
            const anchor = sel.anchorNode as Node | null;
            const focus = sel.focusNode as Node | null;
            const inPreview = (() => {
              const aIn = anchor && (anchor instanceof Element ? anchor : anchor.parentElement);
              const fIn = focus && (focus instanceof Element ? focus : focus.parentElement);
              const check = (el: Element | null): boolean => {
                if (!el) return false;
                // Preview selectable content is inside [data-vecto-content]
                return !!el.closest?.('[data-vecto-content]');
              };
              return check(aIn as Element | null) || check(fIn as Element | null);
            })();
            if (inPreview) return;
          }
        }
      } catch {
        // ignore
      }
      // 1) Task checkbox toggle — both modes, left edge click
      try {
        if (tryToggleTaskForClientXY(ev.clientX, ev.clientY)) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
      } catch {
        // ignore
      }
      // 2) If click was on a link hotspot, let Markdown's onLinkClick handle navigation
      // Detect via Scene hit test before doing WYSIWYG focus
      try {
        const sceneCoord = scene.clientToScene(ev.clientX, ev.clientY);
        const hit = scene.findEntityAt(sceneCoord.x, sceneCoord.y);
        const href = (hit as unknown as { href?: string } | null)?.href;
        if (typeof href === 'string' && href.length > 0) {
          // It's a LinkHotspot — don't also move caret
          return;
        }
        // Also check if hit is inside a LinkHotspot hotspot child (hitRegions)
        // The parent LinkHotspot is interactive; its children are plain hit regions
        // but findEntityAt should return the hotspot itself when over link text.
      } catch {
        // ignore
      }
      // 3) WYSIWYG click-to-edit — only in live, maps preview Y → source line (reading is preview-only)
      if (viewMode !== 'live') return;
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
    },
    true,
  );

  const handleStageClickForWysiwyg = (ev: MouseEvent): void => {
    if (viewMode !== 'live') return;
    const target = ev.target as HTMLElement | null;
    if (
      target?.closest('#scribe-split-handle, #scribe-backdrop, button, a, input, select, textarea')
    ) {
      if (!target.closest('#scribe-stage')) return;
      if (
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT'
      )
        return;
    }
    if (
      (ev as unknown as { detail?: number }).detail !== undefined &&
      (ev as MouseEvent).detail >= 2
    )
      return;
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
  void handleStageClickForWysiwyg;
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
    if (!focusMode || viewMode !== 'live') {
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
  // wheel -> focusHighlight removed: overlay follows scroll via scrollTo wrapper + interval; wheel tick no longer thrashes rAF
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

  // ── Inline WYSIWYG (Obsidian Live Preview) — per-block source overlay ──
  renderInlineWysiwyg = (): void => {
    if (!inlineSourceEl) return;
    if (viewMode !== 'live') {
      inlineSourceEl.hidden = true;
      inlineSourceEl.classList.remove('is-visible');
      const prevIdx = lastInlineActiveIdx;
      lastInlineActiveIdx = -1;
      try {
        const content = markdown.content as unknown as {
          children?: Array<{ opacity?: number }>;
        };
        if (prevIdx !== -1 && content?.children?.[prevIdx]) {
          const prev = content.children[prevIdx];
          if (prev && typeof prev.opacity === 'number') prev.opacity = 1;
        }
        if (content?.children) {
          for (const ch of content.children) {
            if (typeof ch.opacity === 'number' && ch.opacity !== 1) ch.opacity = 1;
          }
        }
        scene.markDirty();
      } catch {
        // ignore
      }
      return;
    }
    const source = textArea.value ?? '';
    const blocks = getSourceBlocks(source);
    if (blocks.length === 0) {
      inlineSourceEl.hidden = true;
      inlineSourceEl.classList.remove('is-visible');
      lastInlineActiveIdx = -1;
      return;
    }
    const selStart = textArea.selectionStart ?? 0;
    const selEnd = textArea.selectionEnd ?? selStart;
    const activeIdx = findActiveBlockIdx(selStart, selEnd, blocks);
    // Restore previous hidden block
    const content = markdown.content as unknown as {
      children?: Array<{ opacity?: number }>;
    };
    if (lastInlineActiveIdx !== -1 && lastInlineActiveIdx !== activeIdx) {
      const prev = content?.children?.[lastInlineActiveIdx];
      if (prev && typeof prev.opacity === 'number') prev.opacity = 1;
    }
    if (activeIdx === -1) {
      inlineSourceEl.hidden = true;
      inlineSourceEl.classList.remove('is-visible');
      lastInlineActiveIdx = -1;
      scene.markDirty();
      return;
    }
    const block = blocks[activeIdx];
    // Display math is preview-only; never overlay source (prevents $$ leak over heading)
    if ((block.token as { type?: string })?.type === 'blockMath') {
      inlineSourceEl.hidden = true;
      inlineSourceEl.classList.remove('is-visible');
      // Ensure current block not dimmed
      const curCheck = content?.children?.[activeIdx];
      if (curCheck && typeof curCheck.opacity === 'number' && curCheck.opacity !== 1)
        curCheck.opacity = 1;
      lastInlineActiveIdx = -1;
      scene.markDirty();
      return;
    }
    // Hide rendered block behind overlay to show source (Typora/Obsidian style)
    const cur = content?.children?.[activeIdx];
    if (cur && typeof cur.opacity === 'number') cur.opacity = 0.04;
    lastInlineActiveIdx = activeIdx;
    // Position overlay at block's visual box
    const box = getBlockVisualBox(activeIdx, blocks);
    const previewTop = (previewScroll as unknown as { y: number }).y ?? OUTER_PAD;
    const previewLeft = (previewScroll as unknown as { x: number }).x ?? OUTER_PAD;
    const previewWidth = (previewScroll as unknown as { width: number }).width ?? stage.clientWidth;
    const scrollTop = getPreviewMetrics().scrollTop;
    const fallbackY = (() => {
      if (box) return box.y;
      // proportional fallback when projection empty
      const idxRatio = blocks.length > 1 ? activeIdx / Math.max(1, blocks.length - 1) : 0;
      const contentH = Math.max(previewScroll.height, markdown.height || 400);
      return Math.round(idxRatio * Math.max(0, contentH - 20));
    })();
    const fallbackH = box?.height ?? 24;
    const top = previewTop + fallbackY - scrollTop;
    const height = Math.max(20, fallbackH);
    // Source content as plain pre-wrap
    inlineSourceEl.textContent = block.raw;
    inlineSourceEl.style.top = `${Math.round(top)}px`;
    inlineSourceEl.style.left = `${Math.round(previewLeft + 8)}px`;
    inlineSourceEl.style.width = `${Math.max(120, Math.round(previewWidth - 16))}px`;
    inlineSourceEl.style.height = 'auto';
    inlineSourceEl.style.minHeight = `${Math.round(height)}px`;
    // keep within viewport: adjust max-height if block tall
    const viewportBottom = previewTop + previewScroll.height;
    const avail = Math.max(40, viewportBottom - top - 8);
    if (height > avail) {
      inlineSourceEl.style.maxHeight = `${Math.round(avail)}px`;
      inlineSourceEl.style.overflowY = 'auto';
    } else {
      inlineSourceEl.style.maxHeight = '';
      inlineSourceEl.style.overflowY = 'hidden';
    }
    inlineSourceEl.hidden = false;
    requestAnimationFrame(() => inlineSourceEl.classList.add('is-visible'));
    void height;
  };

  queueInlineWysiwyg = (): void => {
    // Bug B: source/reading must never show inline overlay — hide synchronously and cancel pending (only live shows inline)
    if (viewMode !== 'live') {
      if (inlineRaf) {
        cancelAnimationFrame(inlineRaf);
        inlineRaf = 0;
      }
      // Hide immediately without waiting for rAF; renderInlineWysiwyg will also restore opacities
      try {
        renderInlineWysiwyg();
      } catch {
        // ignore
      }
      if (inlineSourceEl && !inlineSourceEl.hidden) {
        inlineSourceEl.hidden = true;
        inlineSourceEl.classList.remove('is-visible');
      }
      return;
    }
    if (inlineRaf) cancelAnimationFrame(inlineRaf);
    inlineRaf = requestAnimationFrame(() => {
      inlineRaf = 0;
      renderInlineWysiwyg();
    });
  };

  // Keep inline overlay in sync: selection, typing, scroll, layout
  const mirrorForInline = (): HTMLTextAreaElement | null => getMirrorTextarea();
  mirrorForInline()?.addEventListener('keyup', queueInlineWysiwyg);
  mirrorForInline()?.addEventListener('click', queueInlineWysiwyg);
  mirrorForInline()?.addEventListener('input', () => queueInlineWysiwyg());
  mirrorForInline()?.addEventListener('focus', queueInlineWysiwyg);
  mirrorForInline()?.addEventListener('blur', () => {
    // On blur, show all rendered (no active source) — Obsidian hides source when defocused
    // but keep active hidden briefly then hide; for test determinism hide immediately when not focused
    // we keep rendering based on selection even when blurred, so user still sees source for cursor block
    queueInlineWysiwyg();
  });
  document.addEventListener('selectionchange', () => {
    // Bug B: source/reading must never show inline overlay — gate even textarea selection (only live shows inline)
    if (viewMode !== 'live') return;
    const active = document.activeElement as HTMLElement | null;
    if (
      active?.tagName === 'TEXTAREA' ||
      !!active?.closest('[data-vecto-a11y-root], #scribe-a11y-root')
    ) {
      queueInlineWysiwyg();
    } else {
      // selectionchange may fire without focus in live due to programmatic selection

      queueInlineWysiwyg();
    }
  });
  // Scroll and layout changes move overlay with content (wheel no longer directly re-renders overlay: scrollTo wrapper + interval cover it)
  previewScroll.on('pointermove', () => {
    // sync during drag stays subtle; just ensure overlay follows scroll
  });
  // Re-render also nudges inline overlay — gated to live only (Bug B: source/reading must never show)
  setInterval(() => {
    if (viewMode === 'live') queueInlineWysiwyg();
    else if (inlineSourceEl && !inlineSourceEl.hidden) {
      inlineSourceEl.hidden = true;
      inlineSourceEl.classList.remove('is-visible');
    }
  }, 600);
  // Wrap original scrollTo to also move inline overlay (already wrapped for focus, so wrap again)
  const origScrollToInline = (previewScroll as unknown as { scrollTo: (n: number) => void })
    .scrollTo;
  (previewScroll as unknown as { scrollTo: (n: number) => void }).scrollTo = (n: number) => {
    (origScrollToInline as (nn: number) => void)(n);
    queueFocusHighlight();
    queueInlineWysiwyg();
  };
  // Initial inline state
  queueInlineWysiwyg();

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
    const isWysiwygHandle = (): boolean => viewMode !== 'source';
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

  // History helpers — per-file undo/redo via DocumentModel history stack
  const applyHistorySnapshot = (snap: {
    value: string;
    selectionStart: number;
    selectionEnd: number;
  }): void => {
    textArea.value = snap.value;
    textArea.selectionStart = snap.selectionStart;
    textArea.selectionEnd = snap.selectionEnd;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = snap.value;
      mirror.selectionStart = snap.selectionStart;
      mirror.selectionEnd = snap.selectionEnd;
      mirror.focus();
    } else {
      (textArea as unknown as { focused: boolean }).focused = true;
    }
    model.updateContent(model.activeId, snap.value);
    renderMarkdownImmediate(snap.value);
    updateWordCount();
    persistDocument(model);
    if (saveStatusEl) saveStatusEl.textContent = 'Edited';
    scene.markDirty();
  };

  const doUndo = (): boolean => {
    const current = {
      value: textArea.value,
      selectionStart: textArea.selectionStart,
      selectionEnd: textArea.selectionEnd,
    };
    const prev = model.history.undo(model.activeId, current);
    if (!prev) return false;
    applyHistorySnapshot(prev);
    return true;
  };

  const doRedo = (): boolean => {
    const current = {
      value: textArea.value,
      selectionStart: textArea.selectionStart,
      selectionEnd: textArea.selectionEnd,
    };
    const next = model.history.redo(model.activeId, current);
    if (!next) return false;
    applyHistorySnapshot(next);
    return true;
  };

  // Toolbar actions → TextArea insertion then preview rebuild
  const applyAction = (action: ToolbarAction | HistoryAction): void => {
    if (action === 'undo') {
      doUndo();
      return;
    }
    if (action === 'redo') {
      doRedo();
      return;
    }
    const prevSnap = {
      value: textArea.value,
      selectionStart: textArea.selectionStart,
      selectionEnd: textArea.selectionEnd,
    };
    const sel = {
      value: prevSnap.value,
      selectionStart: prevSnap.selectionStart,
      selectionEnd: prevSnap.selectionEnd,
    };
    const next = applyToolbarAction(sel, action as ToolbarAction);
    if (next.value === prevSnap.value) return;
    model.history.push(model.activeId, prevSnap);
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
    updateWordCount();
    persistDocument(model);
    if (saveStatusEl) saveStatusEl.textContent = t('header.save.edited');
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
    lastRenderedValue = content;
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
    updateWordCount();
    scene.markDirty();
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore
    }
    try {
      queueFocusHighlight();
    } catch {
      // ignore
    }
    if (window.innerWidth < 900) {
      explorerNav?.classList.remove('is-open');
      tocNav?.classList.remove('is-open');
      if (backdrop) backdrop.hidden = true;
      document.body.style.overflow = '';
    }
  };

  if (explorerNav) {
    mountExplorer(explorerNav, model, () => {
      const active = model.activeFile;
      if (!active) return;
      const content = active.content;
      lastRenderedValue = content;
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
      updateWordCount();
      persistDocument(model);
      scene.markDirty();
      try {
        queueInlineWysiwyg();
      } catch {
        // ignore
      }
      try {
        queueFocusHighlight();
      } catch {
        // ignore
      }
      if (window.innerWidth < 900) {
        explorerNav?.classList.remove('is-open');
        tocNav?.classList.remove('is-open');
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
  updateWordCount();

  // --- Responsive drawer logic (<900 overlay) — explorer/toc drawers; settings is modal (CTX-0543) ---
  const isOverlay = (): boolean => window.innerWidth < 900;

  const isSettingsOpen = (): boolean => {
    if (!settingsPanel) return false;
    const dlg = settingsPanel as unknown as HTMLDialogElement;
    if (typeof dlg.open === 'boolean')
      return dlg.open || settingsPanel.classList.contains('is-open');
    return settingsPanel.classList.contains('is-open') || !settingsPanel.hasAttribute('hidden');
  };

  const getFocusableInSettings = (): HTMLElement[] => {
    if (!settingsPanel) return [];
    const selectors =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(settingsPanel.querySelectorAll<HTMLElement>(selectors)).filter(
      (el) => el.offsetParent !== null || el === (settingsPanel as unknown as Element),
    );
  };

  const syncDrawerA11y = (): void => {
    const explorerOpen = explorerNav?.classList.contains('is-open') ?? false;
    const tocOpen = tocNav?.classList.contains('is-open') ?? false;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(explorerOpen || tocOpen));
    if (settingsToggle) settingsToggle.setAttribute('aria-expanded', String(isSettingsOpen()));
    const anyDrawerOpen = explorerOpen || tocOpen;
    if (backdrop) {
      backdrop.hidden = !anyDrawerOpen || !isOverlay();
      backdrop.setAttribute('aria-hidden', String(!anyDrawerOpen));
    }
    const settingsModalOpen = isSettingsOpen();
    if (settingsModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = anyDrawerOpen && isOverlay() ? 'hidden' : '';
    }
  };

  const closeDrawers = (): void => {
    explorerNav?.classList.remove('is-open');
    tocNav?.classList.remove('is-open');
    syncDrawerA11y();
  };

  const toggleExplorer = (): void => {
    const willOpen = !(explorerNav?.classList.contains('is-open') ?? false);
    explorerNav?.classList.toggle('is-open', willOpen);
    if (willOpen && window.innerWidth < 640) {
      tocNav?.classList.remove('is-open');
    }
    syncDrawerA11y();
  };

  const openSettings = (): void => {
    if (!settingsPanel) return;
    explorerNav?.classList.remove('is-open');
    tocNav?.classList.remove('is-open');
    if (backdrop) backdrop.hidden = true;
    // restore last active tab before showing
    try {
      activateSettingsTab(activeSettingsTab);
    } catch {
      // ignore
    }
    const dlg = settingsPanel as unknown as HTMLDialogElement;
    if (typeof dlg.showModal === 'function') {
      try {
        if (!dlg.open) dlg.showModal();
      } catch {
        settingsPanel.classList.add('is-open');
        settingsPanel.removeAttribute('hidden');
        settingsPanel.setAttribute('open', '');
      }
    } else {
      settingsPanel.classList.add('is-open');
      settingsPanel.removeAttribute('hidden');
      settingsPanel.setAttribute('open', '');
    }
    settingsToggle?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    syncDrawerA11y();
    requestAnimationFrame(() => {
      // prefer active tab for keyboard nav, else close button
      const activeTabBtn = settingsTabButtons.find(
        (b) => b.getAttribute('aria-selected') === 'true',
      );
      const focusables = getFocusableInSettings();
      const preferred = activeTabBtn ?? settingsCloseBtn ?? focusables[0] ?? settingsPanel;
      (preferred as unknown as HTMLElement)?.focus?.();
    });
  };

  const closeSettings = (): void => {
    if (!settingsPanel) return;
    const dlg = settingsPanel as unknown as HTMLDialogElement;
    if (typeof dlg.close === 'function' && dlg.open) {
      try {
        dlg.close();
      } catch {
        settingsPanel.classList.remove('is-open');
        settingsPanel.removeAttribute('open');
        settingsPanel.setAttribute('hidden', '');
      }
    } else {
      settingsPanel.classList.remove('is-open');
      settingsPanel.removeAttribute('open');
      if (!(dlg as unknown as { open?: boolean }).open) {
        // ensure hidden for fallback div
        try {
          if (!settingsPanel.hasAttribute('open')) {
            // dialog closed; keep hidden state consistent — :not([open]) CSS will hide
          }
        } catch {
          // ignore
        }
      }
    }
    settingsToggle?.setAttribute('aria-expanded', 'false');
    const anyDrawerOpen =
      (explorerNav?.classList.contains('is-open') ?? false) ||
      (tocNav?.classList.contains('is-open') ?? false);
    document.body.style.overflow = anyDrawerOpen && isOverlay() ? 'hidden' : '';
    syncDrawerA11y();
    settingsToggle?.focus();
  };

  menuToggle?.addEventListener('click', toggleExplorer);
  settingsToggle?.addEventListener('click', () => {
    if (isSettingsOpen()) closeSettings();
    else openSettings();
  });
  settingsCloseBtn?.addEventListener('click', closeSettings);

  backdrop?.addEventListener('click', closeDrawers);

  settingsPanel?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target === settingsPanel) closeSettings();
  });
  settingsPanel?.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeSettings();
  });
  settingsPanel?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = getFocusableInSettings();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isSettingsOpen()) {
        e.preventDefault();
        closeSettings();
        return;
      }
      const anyDrawerOpen =
        (explorerNav?.classList.contains('is-open') ?? false) ||
        (tocNav?.classList.contains('is-open') ?? false);
      if (anyDrawerOpen) {
        closeDrawers();
        menuToggle?.focus();
      }
    }
  });

  window.addEventListener('resize', () => {
    if (!isOverlay()) closeDrawers();
    syncDrawerA11y();
  });

  syncDrawerA11y();

  // ── Obsidian-style context menu (CTX-0542) ────────────────────────────
  // Intercept canvas `contextmenu` to show HTML menu instead of browser default.
  // Left-drag selection remains untouched: only `contextmenu` (right-click) is prevented.
  const hasEditorSelection = (): boolean => textArea.selectionStart !== textArea.selectionEnd;

  const syncMirrorFromTextArea = (): void => {
    const m = getMirrorTextarea();
    if (m) {
      m.value = textArea.value;
      m.selectionStart = textArea.selectionStart;
      m.selectionEnd = textArea.selectionEnd;
    }
  };

  const execEditorCopy = (): boolean => {
    if (!hasEditorSelection()) return false;
    const lo = Math.min(textArea.selectionStart, textArea.selectionEnd);
    const hi = Math.max(textArea.selectionStart, textArea.selectionEnd);
    const txt = textArea.value.slice(lo, hi);
    if (!txt) return false;
    try {
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(txt);
      else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    } catch {
      // ignore
    }
    return true;
  };

  const execEditorCut = (): boolean => {
    if (!hasEditorSelection()) return false;
    const s = textArea.selectionStart;
    const e = textArea.selectionEnd;
    const lo = Math.min(s, e);
    const hi = Math.max(s, e);
    const txt = textArea.value.slice(lo, hi);
    try {
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(txt);
    } catch {
      // ignore
    }
    const prevSnap = {
      value: textArea.value,
      selectionStart: s,
      selectionEnd: e,
    };
    model.history.push(model.activeId, prevSnap);
    const nextVal = textArea.value.slice(0, lo) + textArea.value.slice(hi);
    textArea.value = nextVal;
    textArea.selectionStart = lo;
    textArea.selectionEnd = lo;
    lastRenderedValue = nextVal;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = nextVal;
      mirror.selectionStart = lo;
      mirror.selectionEnd = lo;
      mirror.focus();
    }
    model.updateContent(model.activeId, nextVal);
    markdown.setContent(nextVal);
    previewScroll.updateContentSize();
    updateChrome();
    updateToc();
    updateWordCount();
    persistDocument(model);
    if (saveStatusEl) saveStatusEl.textContent = t('header.save.edited');
    scene.markDirty();
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore
    }
    try {
      queueFocusHighlight();
    } catch {
      // ignore
    }
    return true;
  };

  const execEditorPaste = async (): Promise<boolean> => {
    let txt: string | null = null;
    try {
      if (navigator.clipboard?.readText) txt = await navigator.clipboard.readText();
    } catch {
      txt = null;
    }
    if (txt === null || txt === undefined || txt === '') return false;
    const s = textArea.selectionStart;
    const e = textArea.selectionEnd;
    const lo = Math.min(s, e);
    const hi = Math.max(s, e);
    const prevSnap = {
      value: textArea.value,
      selectionStart: s,
      selectionEnd: e,
    };
    model.history.push(model.activeId, prevSnap);
    const nextVal = textArea.value.slice(0, lo) + txt + textArea.value.slice(hi);
    const cursor = lo + txt.length;
    textArea.value = nextVal;
    textArea.selectionStart = cursor;
    textArea.selectionEnd = cursor;
    lastRenderedValue = nextVal;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = nextVal;
      mirror.selectionStart = cursor;
      mirror.selectionEnd = cursor;
      mirror.focus();
      try {
        mirror.setSelectionRange(cursor, cursor);
      } catch {
        // ignore
      }
    }
    model.updateContent(model.activeId, nextVal);
    renderMarkdownImmediate(nextVal);
    updateWordCount();
    persistDocument(model);
    scene.markDirty();
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore
    }
    try {
      queueFocusHighlight();
    } catch {
      // ignore
    }
    return true;
  };

  const execSelectAll = (): boolean => {
    textArea.selectionStart = 0;
    textArea.selectionEnd = textArea.value.length;
    syncMirrorFromTextArea();
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.focus();
      try {
        mirror.setSelectionRange(0, textArea.value.length);
      } catch {
        // ignore
      }
    }
    scene.markDirty();
    updateWordCount();
    try {
      queueInlineWysiwyg();
    } catch {
      // ignore
    }
    try {
      queueFocusHighlight();
    } catch {
      // ignore
    }
    return true;
  };

  const getPreviewSelectionText = (): string => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
      const txt = sel.toString();
      if (!txt || txt.trim().length === 0) return '';
      const anchor = sel.anchorNode as Node | null;
      const focus = sel.focusNode as Node | null;
      const inside = (n: Node | null): boolean => {
        if (!n) return false;
        const el = n instanceof Element ? n : (n.parentElement as Element | null);
        return !!el?.closest?.('[data-vecto-content]');
      };
      if (inside(anchor) || inside(focus)) return txt;
      return '';
    } catch {
      return '';
    }
  };

  const copyTextToClipboard = async (txt: string): Promise<void> => {
    if (!txt) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
        return;
      }
    } catch {
      // fallback
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch {
      // ignore
    }
  };

  // Detect editor pane via geometry; previewScroll.x is the left of the centered preview content.
  const isInEditorPane = (clientX: number): boolean => {
    if (viewMode !== 'source') return false;
    const rect = stage.getBoundingClientRect();
    const xInStage = clientX - rect.left;
    try {
      const pX = (previewScroll as unknown as { x: number }).x;
      if (typeof pX === 'number' && pX > 24) return xInStage < pX;
    } catch {
      // fallback
    }
    return xInStage < rect.width * splitRatio;
  };

  const handleStageContextMenu = (ev: MouseEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('#scribe-context-menu')) return;
    // Only handle clicks that originate inside stage/canvas/a11y projection
    const insideStage =
      !!target?.closest?.('#scribe-stage') || target === canvas || target === stage;
    if (!insideStage) return;
    ev.preventDefault();
    ev.stopPropagation();
    hideContextMenu();

    // Link detection first — highest priority: walk parent chain so a text child inside a link still resolves.
    let linkHref: string | null = null;
    try {
      const pt = scene.clientToScene(ev.clientX, ev.clientY);
      let cur = scene.findEntityAt(pt.x, pt.y) as unknown as {
        href?: string;
        url?: string;
        parent?: unknown;
      } | null;
      while (cur) {
        const candidate = (cur as { href?: string }).href ?? (cur as { url?: string }).url;
        if (typeof candidate === 'string' && candidate.length > 0) {
          linkHref = candidate;
          break;
        }
        cur = (cur as { parent?: unknown }).parent as typeof cur | null;
      }
    } catch {
      // ignore hit-test errors
    }

    if (linkHref) {
      const href = linkHref;
      showContextMenu({
        x: ev.clientX,
        y: ev.clientY,
        items: [
          { id: 'openLink', label: t('context.openLink') },
          { id: 'copyLink', label: t('context.copyLink') },
        ],
        onSelect: (id) => {
          if (id === 'openLink') handleLinkClick(href);
          else if (id === 'copyLink') void copyTextToClipboard(href);
        },
      });
      return;
    }

    // Inside editor pane?
    const inEditor = isInEditorPane(ev.clientX);
    // Also treat direct textarea right-click as editor even if geometry says otherwise
    // (preview's selectable div is also inside the a11y root, so only treat actual <textarea>).
    const isTextareaTarget =
      !!target?.closest?.('textarea') &&
      !!target?.closest?.('[data-vecto-a11y-root], #scribe-a11y-root');
    const showEditor = inEditor || isTextareaTarget;

    if (showEditor) {
      const hasSel = hasEditorSelection();
      showContextMenu({
        x: ev.clientX,
        y: ev.clientY,
        items: [
          {
            id: 'cut',
            label: t('context.cut'),
            accelerator: 'Ctrl+X',
            disabled: !hasSel,
          },
          {
            id: 'copy',
            label: t('context.copy'),
            accelerator: 'Ctrl+C',
            disabled: !hasSel,
          },
          { id: 'paste', label: t('context.paste'), accelerator: 'Ctrl+V' },
          { id: 'sep1', label: '', separator: true },
          {
            id: 'selectAll',
            label: t('context.selectAll'),
            accelerator: 'Ctrl+A',
          },
        ],
        onSelect: (id) => {
          if (id === 'cut') execEditorCut();
          else if (id === 'copy') execEditorCopy();
          else if (id === 'paste') void execEditorPaste();
          else if (id === 'selectAll') execSelectAll();
        },
      });
      return;
    }

    // Generic canvas menu (preview blank area or WYSIWYG background)
    const previewSel = getPreviewSelectionText();
    const hasPreviewSel = previewSel.length > 0;
    const hasEditSel = hasEditorSelection();
    const canUndo = model.history.canUndo(model.activeId);
    const canRedo = model.history.canRedo(model.activeId);
    showContextMenu({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        {
          id: 'undo',
          label: t('context.undo'),
          accelerator: 'Ctrl+Z',
          disabled: !canUndo,
        },
        {
          id: 'redo',
          label: t('context.redo'),
          accelerator: 'Ctrl+Y',
          disabled: !canRedo,
        },
        { id: 'sep1', label: '', separator: true },
        {
          id: 'copy',
          label: t('context.copy'),
          accelerator: 'Ctrl+C',
          disabled: !hasPreviewSel && !hasEditSel,
        },
        { id: 'paste', label: t('context.paste'), accelerator: 'Ctrl+V' },
        { id: 'sep2', label: '', separator: true },
        {
          id: 'selectAll',
          label: t('context.selectAll'),
          accelerator: 'Ctrl+A',
        },
      ],
      onSelect: (id) => {
        if (id === 'undo') void doUndo();
        else if (id === 'redo') void doRedo();
        else if (id === 'copy') {
          if (hasEditSel) execEditorCopy();
          else if (hasPreviewSel) void copyTextToClipboard(previewSel);
        } else if (id === 'paste') void execEditorPaste();
        else if (id === 'selectAll') execSelectAll();
      },
    });
  };

  // Use capture so we prevent the browser's native menu even when the
  // a11y textarea overlay is the event target; keep canvas listener too
  // for environments that don't bubble from canvas.
  stage.addEventListener('contextmenu', handleStageContextMenu, true);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const a11yRoot = document.getElementById('scribe-a11y-root');
  a11yRoot?.addEventListener('contextmenu', (e) => {
    // The stage capture already handles positioning; just prevent default here too
    // to avoid double menu on textarea.
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest?.('#scribe-stage')) e.preventDefault();
  });

  // Dismiss menu on left-click / Escape / drawer interactions — keep text selection left-drag smooth
  // (we do not intercept pointerdown for button 0). Right-click (button 2) must not dismiss
  // the opening menu: the auxclick that follows contextmenu would otherwise race with
  // showContextMenu's deferred attachment and hide it instantly.
  document.addEventListener('click', (e) => {
    if ((e as MouseEvent).button === 2) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest?.('#scribe-context-menu')) return;
    if (isContextMenuVisible()) hideContextMenu();
  });
  document.addEventListener('auxclick', (e) => {
    if ((e as MouseEvent).button === 2) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest?.('#scribe-context-menu')) return;
    if (isContextMenuVisible()) hideContextMenu();
  });
  // Any pointerdown outside menu should hide, but not right-click (button 2) which opens it.
  document.addEventListener('pointerdown', (e) => {
    if ((e as PointerEvent).button === 2) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest?.('#scribe-context-menu')) return;
    if (isContextMenuVisible()) hideContextMenu();
  });
  stage.addEventListener('pointerdown', (e) => {
    if ((e as PointerEvent).button === 2) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt?.closest?.('#scribe-context-menu')) return;
    if (isContextMenuVisible()) hideContextMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isContextMenuVisible()) hideContextMenu();
  });
  // Close when drawer/backdrop opens or settings change
  backdrop?.addEventListener('click', (e) => {
    if ((e as MouseEvent).button === 2) return;
    hideContextMenu();
  });
  // When locale changes, hide stale menu with old labels
  subscribe(() => hideContextMenu());

  // Quick hide helper for double use in drawer keys
  const prevCloseDrawers = closeDrawers;
  void prevCloseDrawers;

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
    const normalized = m === 'wysiwyg' ? 'live' : m;
    if (normalized === 'live' || normalized === 'source' || normalized === 'reading')
      applyViewMode(normalized as ViewMode);
  };
  (window as unknown as { __scribeFocusMode: () => boolean }).__scribeFocusMode = () => focusMode;
  (window as unknown as { __scribeApplyFocusMode: (b: boolean) => void }).__scribeApplyFocusMode = (
    b: boolean,
  ) => applyFocusMode(!!b);
  (window as unknown as { __scribeFocusAtLine: (n: number) => void }).__scribeFocusAtLine = (
    n: number,
  ) => focusAtLine(Math.max(0, n | 0));
  // Inline WYSIWYG helpers (CTX-0541 Phase 2)
  (
    window as unknown as {
      __scribeInlineActiveIdx: () => number;
      __scribeInlineVisible: () => boolean;
      __scribeInlineRaw: () => string | null;
      __scribeGetSourceBlocks: () => SourceBlock[];
      __scribeSetSelection: (start: number, end: number) => void;
    }
  ).__scribeInlineActiveIdx = () => {
    const blocks = getSourceBlocks(textArea.value ?? '');
    return findActiveBlockIdx(textArea.selectionStart ?? 0, textArea.selectionEnd ?? 0, blocks);
  };
  (window as unknown as { __scribeInlineVisible: () => boolean }).__scribeInlineVisible = () =>
    !!inlineSourceEl && !inlineSourceEl.hidden && viewMode === 'live';
  (window as unknown as { __scribeInlineRaw: () => string | null }).__scribeInlineRaw = () =>
    inlineSourceEl && !inlineSourceEl.hidden ? inlineSourceEl.textContent : null;
  (window as unknown as { __scribeGetSourceBlocks: () => SourceBlock[] }).__scribeGetSourceBlocks =
    () => getSourceBlocks(textArea.value ?? '');
  (
    window as unknown as {
      __scribeSetSelection: (start: number, end: number) => void;
    }
  ).__scribeSetSelection = (start: number, end: number) => {
    textArea.selectionStart = start;
    textArea.selectionEnd = end;
    const mirror = getMirrorTextarea();
    if (mirror) {
      mirror.value = textArea.value;
      mirror.selectionStart = start;
      mirror.selectionEnd = end;
      mirror.focus();
      try {
        mirror.setSelectionRange(start, end);
      } catch {
        // ignore
      }
    }
    queueInlineWysiwyg();
    queueFocusHighlight();
    scene.markDirty();
  };
  (window as unknown as { __scribeQueueInline: () => void }).__scribeQueueInline =
    queueInlineWysiwyg;
  (window as unknown as { __scribeInlineEl: () => HTMLElement | null }).__scribeInlineEl = () =>
    inlineSourceEl;
  (
    window as unknown as {
      __scribeApplyAction: (a: ToolbarAction | HistoryAction) => void;
    }
  ).__scribeApplyAction = applyAction as (a: ToolbarAction | HistoryAction) => void;
  (window as unknown as { __scribeUndo: () => boolean }).__scribeUndo = doUndo;
  (window as unknown as { __scribeRedo: () => boolean }).__scribeRedo = doRedo;
  (window as unknown as { __scribeCanUndo: () => boolean }).__scribeCanUndo = () =>
    model.history.canUndo(model.activeId);
  (window as unknown as { __scribeCanRedo: () => boolean }).__scribeCanRedo = () =>
    model.history.canRedo(model.activeId);
  (window as unknown as { __scribeSyncEditorToPreview: () => void }).__scribeSyncEditorToPreview =
    syncEditorToPreview;
  (window as unknown as { __scribeRenderMarkdown: () => void }).__scribeRenderMarkdown = () => {
    if (model.activeFile) {
      lastRenderedValue = model.activeFile.content;
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

  // Settings modal helpers for e2e (CTX-0543 + tabs)
  (window as unknown as { __scribeSettingsOpen: () => boolean }).__scribeSettingsOpen =
    isSettingsOpen;
  (window as unknown as { __scribeOpenSettings: () => void }).__scribeOpenSettings = openSettings;
  (window as unknown as { __scribeCloseSettings: () => void }).__scribeCloseSettings =
    closeSettings;
  (window as unknown as { __scribeSettingsTab: () => string }).__scribeSettingsTab = () =>
    activeSettingsTab;
  (
    window as unknown as { __scribeActivateSettingsTab: (tab: string) => void }
  ).__scribeActivateSettingsTab = (tab: string) => {
    if ((VALID_TABS as string[]).includes(tab)) {
      activeSettingsTab = tab as SettingsTab;
      activateSettingsTab(activeSettingsTab);
    }
  };

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
