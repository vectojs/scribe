import { ScribeDocument, type ScribeFileEntry } from './DocumentModel';

export const STORAGE_KEY = 'scribe:files-v1';
export const LEGACY_KEY = 'scribe:active-doc-v1';

export type StoredDocument = {
  files: ScribeFileEntry[];
  activeId: string;
};

function isStoredDocument(value: unknown): value is StoredDocument {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.files)) return false;
  if (typeof v.activeId !== 'string') return false;
  for (const f of v.files as unknown[]) {
    if (typeof f !== 'object' || f === null) return false;
    const fe = f as Record<string, unknown>;
    if (typeof fe.id !== 'string' || typeof fe.name !== 'string' || typeof fe.content !== 'string')
      return false;
  }
  return true;
}

function parseStored(value: string | null): StoredDocument | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isStoredDocument(parsed) && parsed.files.length > 0) return parsed;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).files)
    ) {
      const p = parsed as Record<string, unknown>;
      if (Array.isArray(p.files) && p.files.length > 0) {
        const files = p.files as ScribeFileEntry[];
        const activeId = typeof p.activeId === 'string' ? p.activeId : files[0].id;
        return { files, activeId };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function loadDocumentWithStorage(storage: Pick<Storage, 'getItem'>): ScribeDocument | null {
  const primary = parseStored(storage.getItem(STORAGE_KEY));
  if (primary) {
    try {
      const doc = new ScribeDocument(primary.files);
      try {
        doc.setActive(primary.activeId);
      } catch {
        // stale activeId, keep first
      }
      return doc;
    } catch {
      return null;
    }
  }
  const legacy = parseStored(storage.getItem(LEGACY_KEY));
  if (legacy) {
    try {
      const doc = new ScribeDocument(legacy.files);
      try {
        doc.setActive(legacy.activeId);
      } catch {
        // ignore
      }
      return doc;
    } catch {
      return null;
    }
  }
  return null;
}

export function saveDocumentWithStorage(
  doc: ScribeDocument,
  storage: Pick<Storage, 'setItem'>,
): void {
  const payload: StoredDocument = {
    files: [...doc.files],
    activeId: doc.activeId,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function loadDocument(): ScribeDocument | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return loadDocumentWithStorage(window.localStorage);
}

export function saveDocument(doc: ScribeDocument): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  saveDocumentWithStorage(doc, window.localStorage);
}

export function clearStorage(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(STORAGE_KEY);
}
