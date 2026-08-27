import type { ScribeDocument, ScribeFileEntry } from '../model/DocumentModel';
import { saveDocumentWithStorage } from '../model/storage';

export type ExplorerCallbacks = {
  onSwitch: (id: string) => void;
  onAdd: (entry: ScribeFileEntry) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

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
  title.textContent = 'Explorer';
  header.appendChild(title);

  const addBtn = document.createElement('button');
  addBtn.textContent = '+';
  addBtn.title = 'New file';
  addBtn.setAttribute('aria-label', 'New file');
  addBtn.style.width = '20px';
  addBtn.style.height = '20px';
  addBtn.style.border = 'var(--hairline) solid var(--scribe-border)';
  addBtn.style.background = 'var(--scribe-pane-bg)';
  addBtn.style.borderRadius = '4px';
  addBtn.style.cursor = 'pointer';
  addBtn.style.fontSize = '14px';
  addBtn.style.lineHeight = '1';
  addBtn.style.color = 'var(--scribe-muted)';
  addBtn.addEventListener('click', () => {
    const name = `Untitled-${Date.now() % 1000}.md`;
    const entry = doc.addFile(name, `# ${name.replace('.md', '')}\n\n`);
    saveDocumentWithStorage(doc, window.localStorage);
    callbacks.onAdd(entry);
  });
  header.appendChild(addBtn);
  container.appendChild(header);

  const list = document.createElement('ul');
  list.id = 'scribe-file-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Files');
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
    icon.textContent = '📄';
    icon.style.fontSize = '12px';
    icon.style.opacity = '0.7';
    icon.style.flexShrink = '0';
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
    renameBtn.textContent = '✎';
    renameBtn.title = 'Rename';
    renameBtn.setAttribute('aria-label', `Rename ${file.name}`);
    renameBtn.style.width = '20px';
    renameBtn.style.height = '20px';
    renameBtn.style.border = 'none';
    renameBtn.style.background = 'transparent';
    renameBtn.style.cursor = 'pointer';
    renameBtn.style.fontSize = '12px';
    renameBtn.style.color = 'var(--scribe-muted-2)';
    renameBtn.style.flexShrink = '0';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // trigger dblclick logic
      nameSpan.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    li.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.title = doc.files.length <= 1 ? 'Cannot delete last file' : 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete ${file.name}`);
    deleteBtn.disabled = doc.files.length <= 1;
    deleteBtn.style.width = '20px';
    deleteBtn.style.height = '20px';
    deleteBtn.style.border = 'none';
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.cursor = doc.files.length <= 1 ? 'not-allowed' : 'pointer';
    deleteBtn.style.fontSize = '14px';
    deleteBtn.style.color =
      doc.files.length <= 1 ? 'var(--scribe-muted-2)' : 'var(--scribe-muted-2)';
    deleteBtn.style.flexShrink = '0';
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
): void {
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
}
