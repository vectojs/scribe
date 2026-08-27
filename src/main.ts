import { Scene } from '@vectojs/core';
import { Markdown } from '@vectojs/markdown';

import { ScribeDocument } from './model/DocumentModel';

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

  if (!canvas || !stage) throw new Error('Scribe requires #scribe-canvas and #scribe-stage');

  const model = createDefaultDocument();

  // Hybrid shell: Scene is confined to #scribe-stage, not full window.
  // disableWindowResize + ResizeObserver mirrors gallery/numera pattern.
  const scene = new Scene(canvas, {
    disableWindowResize: true,
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
        });
        fileListEl.appendChild(li);
      }
    }
    if (saveStatusEl) saveStatusEl.textContent = 'Saved';
  };

  // Core center: Markdown entity (preview). Source TextArea split lands in CTX-0533.
  const markdown = new Markdown(model.activeFile?.content ?? '# Hello Scribe', {
    maxWidth: Math.max(320, stage.clientWidth - 32),
  });

  scene.add(markdown);
  scene.start();

  const resize = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    // Stage owns size; Scene is disableWindowResize, so we size canvas manually.
    canvas.width = w * window.devicePixelRatio;
    canvas.height = h * window.devicePixelRatio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    // Markdown reflows on maxWidth, not raw width/height.
    markdown.setMaxWidth(Math.max(320, w - 32));
    scene.markDirty();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();

  const renderMarkdown = (): void => {
    markdown.setContent(model.activeFile?.content ?? '');
    updateChrome();
    scene.markDirty();
  };

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
