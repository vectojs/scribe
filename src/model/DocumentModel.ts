/**
 * Pure-TS document model for Scribe — no Canvas, DOM, or VectoJS imports.
 * Tested with bun test; consumed by the hybrid view layer.
 */
export type ScribeFileEntry = {
  id: string;
  name: string;
  content: string;
};

export class ScribeDocument {
  private _files: ScribeFileEntry[];
  private _activeId: string;

  constructor(initial?: ScribeFileEntry[]) {
    this._files = initial ?? [
      { id: '1', name: 'Untitled.md', content: '# Hello Scribe\n\nStart writing markdown here.\n' },
      {
        id: '2',
        name: 'Welcome.md',
        content: '# Welcome\n\nThis is a StackEdit-inspired hybrid editor.\n',
      },
      { id: '3', name: 'Notes.md', content: '# Notes\n\n- Item one\n- Item two\n' },
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
}
