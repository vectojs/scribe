import { describe, expect, test } from 'bun:test';

import { ScribeDocument } from '../src/model/DocumentModel';

describe('ScribeDocument', () => {
  test('defaults to three files and first active', () => {
    const doc = new ScribeDocument();
    expect(doc.files).toHaveLength(3);
    expect(doc.activeFile?.name).toBe('Untitled.md');
  });

  test('setActive switches file', () => {
    const doc = new ScribeDocument();
    const second = doc.files[1];
    doc.setActive(second.id);
    expect(doc.activeId).toBe(second.id);
    expect(doc.activeFile?.name).toBe(second.name);
  });

  test('updateContent mutates file content', () => {
    const doc = new ScribeDocument();
    const id = doc.activeId;
    doc.updateContent(id, '# new');
    expect(doc.activeFile?.content).toBe('# new');
  });

  test('addFile appends and returns entry', () => {
    const doc = new ScribeDocument();
    const entry = doc.addFile('Extra.md', 'hello');
    expect(doc.files).toHaveLength(4);
    expect(entry.name).toBe('Extra.md');
  });

  test('setActive throws on unknown id', () => {
    const doc = new ScribeDocument();
    expect(() => doc.setActive('nope')).toThrow();
  });
});
