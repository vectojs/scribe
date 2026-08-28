import { subscribe, t } from '../i18n';
import type { ScribeDocument, ScribeFileEntry } from '../model/DocumentModel';
import { saveDocumentWithStorage } from '../model/storage';

export type ExplorerCallbacks = {
  onSwitch: (id: string) => void;
  onAdd: (entry: ScribeFileEntry) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

function createLucideSvg(inner: string, size = 14): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg') as unknown as SVGElement;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.flexShrink = '0';
  svg.style.display = 'block';
  // inner contains raw tags like <path .../> etc
  svg.innerHTML = inner;
  return svg;
}

export function renderExplorer(
  container: HTMLElement,
  doc: ScribeDocument,
  callbacks: ExplorerCallbacks,
): void {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.padding = '0 12px 8px';
  header.style.fontSize = '11px';
  header.style.fontWeight = '600';
  header.style.textTransform = 'uppercase';
  header.style.letterSpacing = '0.06em';
  header.style.color = 'var(--scribe-muted-2)';
  header.style.fontFamily = 'system-ui, sans-serif';

  const title = document.createElement('span');
  title.textContent = t('explorer.title');
  header.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.title = t('explorer.newFile.title');
  addBtn.setAttribute('aria-label', t('explorer.newFile.label'));
  addBtn.style.width = '20px';
  addBtn.style.height = '20px';
  addBtn.style.display = 'inline-flex';
  addBtn.style.alignItems = 'center';
  addBtn.style.justifyContent = 'center';
  addBtn.style.border = 'var(--hairline) solid var(--scribe-border)';
  addBtn.style.background = 'var(--scribe-pane-bg)';
  addBtn.style.borderRadius = '4px';
  addBtn.style.cursor = 'pointer';
  addBtn.style.color = 'var(--scribe-muted)';
  addBtn.style.padding = '0';
  const plusSvg = createLucideSvg(
    '<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />',
    12,
  );
  addBtn.appendChild(plusSvg);
  addBtn.addEventListener('click', () => {
    const pattern = t('files.untitledPattern');
    const suffix = String(Date.now() % 1000);
    const name = pattern.includes('{n}') ? pattern.replace('{n}', suffix) : `Untitled-${suffix}.md`;
    const entry = doc.addFile(name, `# ${name.replace('.md', '')}\n\n`);
    saveDocumentWithStorage(doc, window.localStorage);
    callbacks.onAdd(entry);
  });
  header.appendChild(addBtn);
  container.appendChild(header);

  const list = document.createElement('ul');
  list.id = 'scribe-file-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('explorer.listLabel'));
  list.style.listStyle = 'none';
  list.style.margin = '0';
  list.style.padding = '0';

  for (const file of doc.files) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(file.id === doc.activeId));
    li.dataset.fileId = file.id;
    li.style.display = 'flex';
    li.style.alignItems = 'center';
    li.style.gap = '6px';
    li.style.padding = '6px 12px';
    li.style.fontSize = '14px';
    li.style.fontFamily = 'system-ui, sans-serif';
    li.style.cursor = 'pointer';
    li.style.borderLeft = '2px solid transparent';
    li.style.color = 'var(--scribe-fg)';
    li.style.background = file.id === doc.activeId ? 'var(--scribe-accent-bg)' : 'transparent';
    if (file.id === doc.activeId) li.style.borderLeftColor = 'var(--scribe-accent)';

    li.addEventListener('mouseenter', () => {
      if (file.id !== doc.activeId) li.style.background = 'var(--scribe-bg)';
    });
    li.addEventListener('mouseleave', () => {
      li.style.background = file.id === doc.activeId ? 'var(--scribe-accent-bg)' : 'transparent';
    });

    const icon = document.createElement('span');
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.flexShrink = '0';
    icon.style.color = 'var(--scribe-muted-2)';
    icon.style.opacity = '0.9';
    const fileSvg = createLucideSvg(
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="15 2 15 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />',
      14,
    );
    icon.appendChild(fileSvg);
    li.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = file.name;
    nameSpan.style.flex = '1';
    nameSpan.style.overflow = 'hidden';
    nameSpan.style.textOverflow = 'ellipsis';
    nameSpan.style.whiteSpace = 'nowrap';
    nameSpan.addEventListener('click', () => {
      if (doc.activeId !== file.id) {
        callbacks.onSwitch(file.id);
      }
    });

    // Rename on double click
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = file.name;
      input.style.flex = '1';
      input.style.fontSize = '14px';
      input.style.fontFamily = 'system-ui, sans-serif';
      input.style.border = '1px solid var(--scribe-accent)';
      input.style.borderRadius = '3px';
      input.style.padding = '2px 4px';
      input.style.background = 'var(--scribe-pane-bg)';
      const finish = (): void => {
        const newName = input.value.trim() || file.name;
        if (newName !== file.name) {
          try {
            doc.renameFile(file.id, newName);
            saveDocumentWithStorage(doc, window.localStorage);
            callbacks.onRename(file.id, newName);
          } catch {
            // noop
          }
        } else {
          callbacks.onRename(file.id, file.name);
        }
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') finish();
        if (ev.key === 'Escape') {
          callbacks.onRename(file.id, file.name);
        }
      });
      input.addEventListener('blur', finish);
      nameSpan.replaceWith(input);
      input.focus();
      input.select();
    });

    li.appendChild(nameSpan);

    const renameBtn = document.createElement('button');
    renameBtn.title = t('explorer.rename.title');
    renameBtn.setAttribute('aria-label', t('explorer.rename.label', { name: file.name }));
    renameBtn.style.width = '20px';
    renameBtn.style.height = '20px';
    renameBtn.style.display = 'inline-flex';
    renameBtn.style.alignItems = 'center';
    renameBtn.style.justifyContent = 'center';
    renameBtn.style.border = 'none';
    renameBtn.style.background = 'transparent';
    renameBtn.style.cursor = 'pointer';
    renameBtn.style.color = 'var(--scribe-muted-2)';
    renameBtn.style.flexShrink = '0';
    renameBtn.style.padding = '0';
    const pencilSvg = createLucideSvg(
      '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /><path d="M15 5l4 4" />',
      12,
    );
    renameBtn.appendChild(pencilSvg);
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // trigger dblclick logic
      nameSpan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    li.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.title =
      doc.files.length <= 1 ? t('explorer.delete.disabled') : t('explorer.delete.title');
    deleteBtn.setAttribute('aria-label', t('explorer.delete.label', { name: file.name }));
    deleteBtn.disabled = doc.files.length <= 1;
    deleteBtn.style.width = '20px';
    deleteBtn.style.height = '20px';
    deleteBtn.style.display = 'inline-flex';
    deleteBtn.style.alignItems = 'center';
    deleteBtn.style.justifyContent = 'center';
    deleteBtn.style.border = 'none';
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.cursor = doc.files.length <= 1 ? 'not-allowed' : 'pointer';
    deleteBtn.style.color = 'var(--scribe-muted-2)';
    deleteBtn.style.flexShrink = '0';
    deleteBtn.style.padding = '0';
    deleteBtn.style.opacity = doc.files.length <= 1 ? '0.4' : '1';
    const trashSvg = createLucideSvg(
      '<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />',
      12,
    );
    deleteBtn.appendChild(trashSvg);
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (doc.files.length <= 1) return;
      try {
        doc.removeFile(file.id);
        saveDocumentWithStorage(doc, window.localStorage);
        callbacks.onDelete(file.id);
      } catch {
        // ignore
      }
    });
    li.appendChild(deleteBtn);

    // Switch active via clicking row (except buttons)
    li.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === nameSpan) return;
      if (target === renameBtn || target === deleteBtn) return;
      if (target.closest('button')) return;
      if (doc.activeId !== file.id) callbacks.onSwitch(file.id);
    });

    list.appendChild(li);
  }

  container.appendChild(list);
}

export function mountExplorer(
  explorerNav: HTMLElement,
  doc: ScribeDocument,
  onUpdate: () => void,
): { rerender: () => void; destroy: () => void } {
  const rerender = (): void => {
    renderExplorer(explorerNav, doc, {
      onSwitch: (id) => {
        try {
          doc.setActive(id);
          saveDocumentWithStorage(doc, window.localStorage);
          onUpdate();
          rerender();
        } catch {
          // ignore
        }
      },
      onAdd: () => {
        onUpdate();
        rerender();
      },
      onRename: () => {
        onUpdate();
        rerender();
      },
      onDelete: () => {
        // after delete, active may have changed
        saveDocumentWithStorage(doc, window.localStorage);
        onUpdate();
        rerender();
      },
    });
  };
  rerender();
  const unsubscribe = subscribe(() => rerender());
  return { rerender, destroy: () => unsubscribe() };
}
