import { describe, expect, test } from 'bun:test';

import { ScribeDocument } from '../src/model/DocumentModel';
import {
  LEGACY_KEY,
  STORAGE_KEY,
  loadDocumentWithStorage,
  saveDocumentWithStorage,
} from '../src/model/storage';

function createMockStorage(initial?: Record<string, string>): Map<string, string> & Storage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  const storage = {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
  } as unknown as Map<string, string> & Storage;
  // keep map ref for inspection
  (storage as unknown as { _map: Map<string, string> })._map = map;
  return storage;
}

describe('storage', () => {
  test('save and load roundtrip', () => {
    const storage = createMockStorage();
    const doc = new ScribeDocument([{ id: 'a', name: 'A.md', content: '# A' }]);
    saveDocumentWithStorage(doc, storage);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    const loaded = loadDocumentWithStorage(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.files).toHaveLength(1);
    expect(loaded?.activeId).toBe('a');
    expect(loaded?.activeFile?.content).toBe('# A');
  });

  test('legacy key migration', () => {
    const doc = new ScribeDocument([{ id: 'x', name: 'X.md', content: 'hi' }]);
    const payload = JSON.stringify({
      files: doc.files,
      activeId: doc.activeId,
    });
    const storage = createMockStorage({ [LEGACY_KEY]: payload });
    const loaded = loadDocumentWithStorage(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.files[0].id).toBe('x');
  });

  test('primary key takes precedence over legacy', () => {
    const doc1 = new ScribeDocument([{ id: 'p', name: 'Primary.md', content: 'primary' }]);
    const doc2 = new ScribeDocument([{ id: 'l', name: 'Legacy.md', content: 'legacy' }]);
    const storage = createMockStorage({
      [STORAGE_KEY]: JSON.stringify({
        files: doc1.files,
        activeId: doc1.activeId,
      }),
      [LEGACY_KEY]: JSON.stringify({
        files: doc2.files,
        activeId: doc2.activeId,
      }),
    });
    const loaded = loadDocumentWithStorage(storage);
    expect(loaded?.activeId).toBe('p');
    expect(loaded?.files[0].name).toBe('Primary.md');
  });

  test('corrupt storage returns null', () => {
    const storage = createMockStorage({ [STORAGE_KEY]: 'not json' });
    expect(loadDocumentWithStorage(storage)).toBeNull();
  });

  test('empty storage returns null', () => {
    const storage = createMockStorage();
    expect(loadDocumentWithStorage(storage)).toBeNull();
  });

  test('persist activeId', () => {
    const storage = createMockStorage();
    const doc = new ScribeDocument([
      { id: '1', name: 'A.md', content: 'a' },
      { id: '2', name: 'B.md', content: 'b' },
    ]);
    doc.setActive('2');
    saveDocumentWithStorage(doc, storage);
    const loaded = loadDocumentWithStorage(storage);
    expect(loaded?.activeId).toBe('2');
  });
});
