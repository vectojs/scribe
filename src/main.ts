import { Scene } from '@vectojs/core';
import { Markdown } from '@vectojs/markdown';
import { DOCUMENT_SCROLL_PHYSICS, ScrollView } from '@vectojs/ui';

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
  const fileNameEl = document.getElementById('scribe-file-name') as HTMLElement | null;
  const saveStatusEl = document.getElementById('scribe-save-status') as HTMLElement | null;
  const explorerNav = document.getElementById('scribe-explorer') as HTMLElement | null;
  const tocNav = document.getElementById('scribe-toc') as HTMLElement | null;
  const tocListEl = document.getElementById('scribe-toc-list') as HTMLElement | null;
  const exportMdBtn = document.getElementById('scribe-export-md') as HTMLElement | null;
  const exportHtmlBtn = document.getElementById('scribe-export-html') as HTMLElement | null;
  const exportPdfBtn = document.getElementById('scribe-export-pdf') as HTMLElement | null;
  const syncContainer = document.getElementById('scribe-sync') as HTMLElement | null;

  if (!canvas || !stage) throw new Error('Scribe requires #scribe-canvas and #scribe-stage');

  const model = createDocument();
  const cloudSync = new CloudSyncStub(window.localStorage);

  const scene = new Scene(canvas, {
    disableWindowResize: true,
  });

  const initialContent = model.activeFile?.content ?? '# Hello Scribe';
  const markdown = new Markdown(initialContent, {
    maxWidth: Math.max(320, stage.clientWidth - 32),
  });

  const previewScroll = new ScrollView({
    width: stage.clientWidth,
    height: stage.clientHeight,
    scrollPhysics: DOCUMENT_SCROLL_PHYSICS,
  });
  previewScroll.add(markdown);
  scene.add(previewScroll);
  scene.start();

  const updateChrome = (): void => {
    const active = model.activeFile;
    if (fileNameEl) fileNameEl.textContent = active?.name ?? 'Untitled.md';
    if (saveStatusEl) saveStatusEl.textContent = 'Saved';
  };

  const updateToc = (): void => {
    const target = tocListEl ?? tocNav;
    if (!target) return;
    const text = model.activeFile?.content ?? '';
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

  const renderMarkdown = (): void => {
    const content = model.activeFile?.content ?? '';
    markdown.setContent(content);
    updateChrome();
    updateToc();
    // Defer scroll size sync to next frame; Markdown layout is sync but ScrollView polls extents per frame.
    // Force an immediate size sync for correct maxScroll.
    previewScroll.updateContentSize();
    scene.markDirty();
  };

  const resize = (): void => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    canvas.width = w * window.devicePixelRatio;
    canvas.height = h * window.devicePixelRatio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    previewScroll.width = w;
    previewScroll.height = h;
    markdown.setMaxWidth(Math.max(320, w - 32));
    previewScroll.updateContentSize();
    scene.markDirty();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();

  if (explorerNav) {
    mountExplorer(explorerNav, model, () => {
      persistDocument(model);
      renderMarkdown();
    });
  } else {
    // fallback to legacy file-list wiring if explorer nav missing
    const fileListEl = document.getElementById('scribe-file-list') as HTMLElement | null;
    if (fileListEl) {
      const legacyUpdate = (): void => {
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
              legacyUpdate();
            });
            fileListEl.appendChild(li);
          }
        }
      };
      legacyUpdate();
    }
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

  window.__app = { scene, model, markdown, previewScroll };

  const maybeAttachDevtools = async (): Promise<void> => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    try {
      const { attachDevtools } = await import('@vectojs/devtools');
      attachDevtools(scene);
    } catch {
      // devtools optional
    }
  };
  void maybeAttachDevtools();

  updateChrome();

  window.addEventListener('beforeunload', () => {
    persistDocument(model);
  });

  // Expose helper for CTX-0533 editor integration and TOC click testing
  (window as unknown as { __scribeRenderMarkdown: () => void }).__scribeRenderMarkdown =
    renderMarkdown;
  (window as unknown as { __scribeUpdateToc: () => void }).__scribeUpdateToc = updateToc;
}

mountScribe();
