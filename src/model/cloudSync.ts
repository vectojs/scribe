export type SyncProvider = 'local' | 'github' | 'drive';

export type SyncState = {
  provider: SyncProvider;
  lastSyncAt: string | null;
  enabled: boolean;
};

export const CLOUD_SYNC_STORAGE_KEY = 'scribe:cloud-sync-v1';

const DEFAULT_STATE: SyncState = {
  provider: 'local',
  lastSyncAt: null,
  enabled: false,
};

function parseSyncState(raw: string | null): SyncState {
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    if (
      parsed.provider === 'local' ||
      parsed.provider === 'github' ||
      parsed.provider === 'drive'
    ) {
      return {
        provider: parsed.provider,
        lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : false,
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_STATE };
}

export class CloudSyncStub {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {
    if (storage) this.storage = storage;
    else if (typeof window !== 'undefined' && window.localStorage)
      this.storage = window.localStorage;
    else this.storage = null;
  }

  getState(): SyncState {
    if (!this.storage) return { ...DEFAULT_STATE };
    return parseSyncState(this.storage.getItem(CLOUD_SYNC_STORAGE_KEY));
  }

  setProvider(provider: SyncProvider): SyncState {
    const next: SyncState = {
      provider,
      lastSyncAt: new Date().toISOString(),
      enabled: provider !== 'local',
    };
    if (this.storage) this.storage.setItem(CLOUD_SYNC_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  disable(): SyncState {
    const next: SyncState = { ...DEFAULT_STATE };
    if (this.storage) this.storage.setItem(CLOUD_SYNC_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  async sync(): Promise<SyncState> {
    const state = this.getState();
    if (state.provider === 'local') return state;
    // Placeholder: no network, no secret commit.
    // Future: implement GitHub/Drive sync with OAuth token held in memory only.
    // Keep localStorage primary; remote is secondary.
    const next: SyncState = { ...state, lastSyncAt: new Date().toISOString() };
    if (this.storage) this.storage.setItem(CLOUD_SYNC_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  // Placeholder hooks — no secret commit, no token persistence in repo.

  async connectGitHub(_token: string): Promise<SyncState> {
    // Token is kept in memory only in real implementation; stub persists provider only.
    return this.setProvider('github');
  }

  async connectDrive(_token: string): Promise<SyncState> {
    return this.setProvider('drive');
  }
}

export function createCloudSync(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
): CloudSyncStub {
  return new CloudSyncStub(storage);
}
