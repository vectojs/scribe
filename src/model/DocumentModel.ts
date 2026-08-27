/**
 * Pure-TS document model for Scribe — no Canvas, DOM, or VectoJS imports.
 * Tested with bun test; consumed by the hybrid view layer.
 */
import { SAMPLE_FILE_NAME, SAMPLE_MARKDOWN } from './sampleContent';

export type ScribeFileEntry = {
  id: string;
  name: string;
  content: string;
};

export const DEFAULT_SAMPLE_FILE: ScribeFileEntry = {
  id: '1',
  name: SAMPLE_FILE_NAME,
  content: SAMPLE_MARKDOWN,
};

export type HistorySnapshot = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export class DocumentHistory {
  private undoStacks = new Map<string, HistorySnapshot[]>();
  private redoStacks = new Map<string, HistorySnapshot[]>();
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  private getUndo(id: string): HistorySnapshot[] {
    let s = this.undoStacks.get(id);
    if (!s) {
      s = [];
      this.undoStacks.set(id, s);
    }
    return s;
  }

  private getRedo(id: string): HistorySnapshot[] {
    let s = this.redoStacks.get(id);
    if (!s) {
      s = [];
      this.redoStacks.set(id, s);
    }
    return s;
  }

  push(id: string, snapshot: HistorySnapshot): void {
    const undo = this.getUndo(id);
    const last = undo[undo.length - 1];
    if (last && last.value === snapshot.value) return;
    undo.push({ ...snapshot });
    if (undo.length > this.maxSize) undo.shift();
    this.getRedo(id).length = 0;
  }

  canUndo(id: string): boolean {
    return (this.undoStacks.get(id)?.length ?? 0) > 0;
  }

  canRedo(id: string): boolean {
    return (this.redoStacks.get(id)?.length ?? 0) > 0;
  }

  undo(id: string, current: HistorySnapshot): HistorySnapshot | null {
    const undo = this.undoStacks.get(id);
    if (!undo || undo.length === 0) return null;
    const prev = undo.pop()!;
    this.getRedo(id).push({ ...current });
    return prev;
  }

  redo(id: string, current: HistorySnapshot): HistorySnapshot | null {
    const redo = this.redoStacks.get(id);
    if (!redo || redo.length === 0) return null;
    const next = redo.pop()!;
    this.getUndo(id).push({ ...current });
    return next;
  }

  clear(id: string): void {
    this.undoStacks.delete(id);
    this.redoStacks.delete(id);
  }
}

export class ScribeDocument {
  private _files: ScribeFileEntry[];
  private _activeId: string;
  readonly history = new DocumentHistory();

  constructor(initial?: ScribeFileEntry[]) {
    this._files = initial ?? [
      DEFAULT_SAMPLE_FILE,
      {
        id: '2',
        name: 'Welcome.md',
        content: '# Welcome\n\nThis is a StackEdit-inspired hybrid editor.\n',
      },
      {
        id: '3',
        name: 'Notes.md',
        content: '# Notes\n\n- Item one\n- Item two\n',
      },
    ];
    this._activeId = this._files[0]?.id ?? '1';
  }

  get files(): readonly ScribeFileEntry[] {
    return this._files;
  }

  get activeId(): string {
    return this._activeId;
  }

  get activeFile(): ScribeFileEntry | undefined {
    return this._files.find((f) => f.id === this._activeId);
  }

  setActive(id: string): void {
    if (!this._files.some((f) => f.id === id)) throw new Error(`Unknown file id: ${id}`);
    this._activeId = id;
  }

  updateContent(id: string, content: string): void {
    const file = this._files.find((f) => f.id === id);
    if (!file) throw new Error(`Unknown file id: ${id}`);
    file.content = content;
  }

  addFile(name: string, content = ''): ScribeFileEntry {
    const entry: ScribeFileEntry = { id: String(Date.now()), name, content };
    this._files.push(entry);
    return entry;
  }

  renameFile(id: string, name: string): void {
    const file = this._files.find((f) => f.id === id);
    if (!file) throw new Error(`Unknown file id: ${id}`);
    file.name = name;
  }

  removeFile(id: string): void {
    if (this._files.length <= 1) throw new Error('Cannot remove last file');
    const idx = this._files.findIndex((f) => f.id === id);
    if (idx === -1) throw new Error(`Unknown file id: ${id}`);
    this._files.splice(idx, 1);
    if (this._activeId === id) this._activeId = this._files[0].id;
    this.history.clear(id);
  }
}
