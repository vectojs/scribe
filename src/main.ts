import { Scene } from '@vectojs/core';
import { Markdown } from '@vectojs/markdown';

import { ScribeDocument } from './model/DocumentModel';
import { isValidStageSize, markdownMaxWidth } from './utils/dpr';

declare global {
  interface Window {
    __app?: {
      scene: Scene;
      model: ScribeDocument;
      markdown: Markdown;
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
  const fileNameEl = document.getElementById('scribe-file-name') as HTMLElement | null;
  const saveStatusEl = document.getElementById('scribe-save-status') as HTMLElement | null;
  const fileListEl = document.getElementById('scribe-file-list') as HTMLElement | null;
  const menuToggle = document.getElementById('scribe-menu-toggle') as HTMLButtonElement | null;
  const settingsToggle = document.getElementById(
    'scribe-settings-toggle',
  ) as HTMLButtonElement | null;
  const explorer = document.getElementById('scribe-explorer') as HTMLElement | null;
  const settings = document.getElementById('scribe-settings') as HTMLElement | null;
  const backdrop = document.getElementById('scribe-backdrop') as HTMLElement | null;

  if (!canvas || !stage) throw new Error('Scribe requires #scribe-canvas and #scribe-stage');

  const model = createDefaultDocument();

  // Hybrid shell: Scene is confined to #scribe-stage, not full window.
  // disableWindowResize + ResizeObserver mirrors gallery/numera pattern.
  // maxDPR:3 caps backing-store at 3× (covers DPR 1/1.5/2/3), guard NaN/Infinity via helper.
  const scene = new Scene(canvas, {
    disableWindowResize: true,
    maxDPR: 3,
  });

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
          updateChrome();
          renderMarkdown();
          // On mobile overlay (<900), close drawer after navigation for touch ergonomics.
          if (window.innerWidth < 900) closeDrawers();
        });
        fileListEl.appendChild(li);
      }
    }
    if (saveStatusEl) saveStatusEl.textContent = 'Saved';
  };

  // Core center: Markdown entity (preview). Source TextArea split lands in CTX-0533.
  const markdown = new Markdown(model.activeFile?.content ?? '# Hello Scribe', {
    maxWidth: markdownMaxWidth(stage.clientWidth),
  });

  scene.add(markdown);
  scene.start();

  // DPR-aware resize: delegates backing-store to Scene.resize so rounding/max guard
  // stays in one place (CanvasRenderer.resize: Math.round(css*dpr) max(1), NaN/Infinity→1).
  // Guards 0-height transient from iOS Safari URL-bar collapse.
  const resizeStage = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!isValidStageSize(w, h)) return;
    // Scene owns DPR scaling (effectiveDPR + maxDPR 3, poll fallback + epsilon 0.001
    // in Scene.watchDevicePixelRatio). We only reflow Markdown on css width.
    scene.resize(w, h);
    markdown.setMaxWidth(markdownMaxWidth(w));
  };

  const observer = new ResizeObserver(resizeStage);
  observer.observe(stage);
  // Initial sizing: handles detached or 0-height at mount; Scene's poll will retry
  // if DPR changes before the next ResizeObserver callback.
  resizeStage();

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
        // Epsilon 0.001 mirrors Scene — ignores fractional jitter at 110% zoom.
        if (Math.abs(next - lastDpr) <= 0.001) {
          armDprWatch();
          return;
        }
        lastDpr = next;
        // Re-run stage resize so backing store re-scales even without stage resize.
        resizeStage();
        armDprWatch();
      };
      mq.addEventListener('change', handler, { once: true });
    };
    armDprWatch();
  }

  const renderMarkdown = (): void => {
    markdown.setContent(model.activeFile?.content ?? '');
    updateChrome();
    scene.markDirty();
  };

  // --- Responsive drawer logic (<900 overlay, <640 hamburger) ---
  const isOverlay = (): boolean => window.innerWidth < 900;

  const syncDrawerA11y = (): void => {
    const explorerOpen = explorer?.classList.contains('is-open') ?? false;
    const settingsOpen = settings?.classList.contains('is-open') ?? false;
    if (menuToggle) menuToggle.setAttribute('aria-expanded', String(explorerOpen));
    if (settingsToggle) settingsToggle.setAttribute('aria-expanded', String(settingsOpen));
    const anyOpen = explorerOpen || settingsOpen;
    if (backdrop) {
      backdrop.hidden = !anyOpen || !isOverlay();
      backdrop.setAttribute('aria-hidden', String(!anyOpen));
    }
    // Prevent background scroll when overlay drawer is open (touch ergonomics).
    document.body.style.overflow = anyOpen && isOverlay() ? 'hidden' : '';
    // Respect reduced-motion: drawer transitions are CSS-only, but JS keeps sentinel.
  };

  const closeDrawers = (): void => {
    explorer?.classList.remove('is-open');
    settings?.classList.remove('is-open');
    syncDrawerA11y();
  };

  const toggleExplorer = (): void => {
    const willOpen = !(explorer?.classList.contains('is-open') ?? false);
    explorer?.classList.toggle('is-open', willOpen);
    // On mobile only one drawer at a time to avoid stacking.
    if (willOpen && window.innerWidth < 640) settings?.classList.remove('is-open');
    syncDrawerA11y();
  };

  const toggleSettings = (): void => {
    const willOpen = !(settings?.classList.contains('is-open') ?? false);
    settings?.classList.toggle('is-open', willOpen);
    if (willOpen && window.innerWidth < 640) explorer?.classList.remove('is-open');
    syncDrawerA11y();
  };

  menuToggle?.addEventListener('click', toggleExplorer);
  settingsToggle?.addEventListener('click', toggleSettings);
  backdrop?.addEventListener('click', closeDrawers);

  // Keyboard: Escape closes drawers, focus returns to toggle.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const anyOpen =
        (explorer?.classList.contains('is-open') ?? false) ||
        (settings?.classList.contains('is-open') ?? false);
      if (anyOpen) {
        closeDrawers();
        (menuToggle ?? settingsToggle)?.focus();
      }
    }
  });

  // Resize: leaving overlay mode (>900) clears drawer state so inline layout resumes.
  window.addEventListener('resize', () => {
    if (!isOverlay()) closeDrawers();
    // Stage ResizeObserver handles canvas reflow; this just syncs drawer chrome.
    syncDrawerA11y();
  });

  syncDrawerA11y();

  // Expose for devtools + manual testing. Persist helper on window for debugging.
  window.__app = { scene, model, markdown };

  const maybeAttachDevtools = async (): Promise<void> => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    try {
      const { attachDevtools } = await import('@vectojs/devtools');
      attachDevtools(scene);
    } catch {
      // devtools is optional; ignore if not installed
    }
  };

  void maybeAttachDevtools();

  updateChrome();

  // Simple persistence demo: watch for external model changes (placeholder for CTX-0533 sync).
  window.addEventListener('beforeunload', () => {
    persistDocument(model);
  });

  // Keep markdown live when model content changes from HTML controls (future TextArea integration).
  // For now, expose a helper so CTX-0533 can wire the editor.
  (window as unknown as { __scribeRenderMarkdown: () => void }).__scribeRenderMarkdown =
    renderMarkdown;
}

mountScribe();
