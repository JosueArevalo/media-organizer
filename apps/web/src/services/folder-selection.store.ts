export type FolderSlot = 'source' | 'destination';

export type FolderSelectionSource = 'native' | 'fallback';

export type SourceTreeFileNode = {
  kind: 'file';
  name: string;
  path: string;
  sizeBytes: number;
  fileType: string;
};

export type SourceTreeDirectoryNode = {
  kind: 'directory';
  name: string;
  path: string;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  children: SourceTreeNode[];
};

export type SourceTreeNode = SourceTreeDirectoryNode | SourceTreeFileNode;

export type FolderSelectionSnapshot = {
  slot: FolderSlot;
  name: string;
  path: string | null;
  updatedAt: number;
  source: FolderSelectionSource;
  persisted: boolean;
};

export type SourceSelectionScopeSnapshot = {
  excludedDirectories: string[];
  excludedFiles: string[];
  includedDirectories: string[];
  includedFiles: string[];
  updatedAt: number;
};

type SelectionMetadata = {
  name: string;
  path: string | null;
  updatedAt: number;
  source: FolderSelectionSource;
};

type SelectionRecord = SelectionMetadata & {
  slot: FolderSlot;
  handle?: FileSystemDirectoryHandle;
};

type SelectionState = Record<FolderSlot, FolderSelectionSnapshot | null>;

const STORAGE_KEY = 'media-organizer-folder-selections';
const TREE_STORAGE_KEY = 'media-organizer-source-tree';
const STORAGE_EVENT_NAME = 'media-organizer-folder-selections-updated';
const DATABASE_NAME = 'media-organizer-state';
const DATABASE_VERSION = 1;
const STORE_NAME = 'folder-selections';
const SCOPE_STORAGE_KEY = 'media-organizer-source-scope';
const handleCache = new Map<FolderSlot, FileSystemDirectoryHandle>();
const openDatabases = new Set<IDBDatabase>();

const registerDatabaseConnection = (database: IDBDatabase) => {
  openDatabases.add(database);

  database.onversionchange = () => {
    try {
      database.close();
    } catch {
      // Ignore close errors when the browser is already tearing down the connection.
    } finally {
      openDatabases.delete(database);
    }
  };
};

const closeDatabaseConnection = (database: IDBDatabase | null | undefined) => {
  if (!database) {
    return;
  }

  try {
    database.close();
  } catch {
    // Ignore close errors and continue cleanup.
  } finally {
    openDatabases.delete(database);
  }
};

const closeAllDatabaseConnections = () => {
  for (const database of openDatabases) {
    closeDatabaseConnection(database);
  }
};

const createEmptyState = (): SelectionState => ({
  source: null,
  destination: null
});

const readMetadata = (): Partial<Record<FolderSlot, SelectionMetadata | null>> => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Partial<Record<FolderSlot, SelectionMetadata | null>>;
  } catch {
    return {};
  }
};

const readTreeSnapshot = (): Partial<Record<FolderSlot, SourceTreeDirectoryNode | null>> => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(TREE_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Partial<Record<FolderSlot, SourceTreeDirectoryNode | null>>;
  } catch {
    return {};
  }
};

const readScopeSnapshot = (): SourceSelectionScopeSnapshot | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as SourceSelectionScopeSnapshot;
  } catch {
    return null;
  }
};

const writeTreeSnapshot = (snapshot: Partial<Record<FolderSlot, SourceTreeDirectoryNode | null>>) => {
  try {
    window.localStorage.setItem(TREE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures and keep the in-memory state.
  }
};

const writeScopeSnapshot = (snapshot: SourceSelectionScopeSnapshot | null) => {
  try {
    if (!snapshot) {
      window.localStorage.removeItem(SCOPE_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures and keep the in-memory state.
  }
};

const writeMetadata = (metadata: Partial<Record<FolderSlot, SelectionMetadata | null>>) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
  } catch {
    // Ignore storage failures and keep the in-memory state.
  }
};

const notifySelectionChange = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME));
};

const hasSelectionName = (selection: SelectionMetadata | null | undefined) =>
  typeof selection?.name === 'string' && selection.name.trim().length > 0;

const isImportStepCompleteFromMetadata = (metadata: Partial<Record<FolderSlot, SelectionMetadata | null>>) =>
  hasSelectionName(metadata.source) && hasSelectionName(metadata.destination);

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'slot' });
      }
    };

    request.onsuccess = () => {
      registerDatabaseConnection(request.result);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
};

const readRecord = async (slot: FolderSlot): Promise<SelectionRecord | null> => {
  const database = await openDatabase().catch((error) => {
    console.warn('Failed to open folder selection database', error);
    return null;
  });

  if (!database) {
    return null;
  }

  try {
    return await new Promise<SelectionRecord | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(slot);

      request.onsuccess = () => resolve((request.result as SelectionRecord | undefined) ?? null);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      console.warn('Failed to read folder selection record', error);
      return null;
    });
  } finally {
    closeDatabaseConnection(database);
  }
};

const writeRecord = async (record: SelectionRecord) => {
  const database = await openDatabase().catch((error) => {
    console.warn('Failed to open folder selection database', error);
    return null;
  });

  if (!database) {
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('Failed to write folder selection record', error);
  } finally {
    closeDatabaseConnection(database);
  }
};

const deleteRecord = async (slot: FolderSlot) => {
  const database = await openDatabase().catch((error) => {
    console.warn('Failed to open folder selection database', error);
    return null;
  });

  if (!database) {
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(slot);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('Failed to delete folder selection record', error);
  } finally {
    closeDatabaseConnection(database);
  }
};

const toSnapshot = (slot: FolderSlot, metadata: SelectionMetadata, persisted: boolean): FolderSelectionSnapshot => ({
  slot,
  name: metadata.name,
  path: metadata.path ?? null,
  updatedAt: metadata.updatedAt,
  source: metadata.source,
  persisted
});

export const loadFolderSelections = async (): Promise<SelectionState> => {
  const metadata = readMetadata();
  const selections = createEmptyState();

  for (const slot of ['source', 'destination'] as const) {
    const slotMetadata = metadata[slot];

    if (slotMetadata) {
      selections[slot] = toSnapshot(slot, slotMetadata, false);
    }

    const record = await readRecord(slot);

    if (record) {
      selections[slot] = toSnapshot(slot, record, true);
    }
  }

  return selections;
};

export const saveFolderSelection = async (
  slot: FolderSlot,
  selection: { name: string; path: string | null; source: FolderSelectionSource; handle?: FileSystemDirectoryHandle }
) => {
  const metadata = readMetadata();
  const nextMetadata = {
    ...metadata,
    [slot]: {
      name: selection.name,
      path: selection.path,
      updatedAt: Date.now(),
      source: selection.source
    }
  };

  writeMetadata(nextMetadata);

  if (selection.handle) {
    handleCache.set(slot, selection.handle);
  } else {
    handleCache.delete(slot);
  }

  if (selection.handle) {
    await writeRecord({
      slot,
      name: selection.name,
      path: selection.path,
      updatedAt: nextMetadata[slot]?.updatedAt ?? Date.now(),
      source: selection.source,
      handle: selection.handle
    });
  } else {
    const existingRecord = await readRecord(slot);

    if (existingRecord) {
      await writeRecord({
        ...existingRecord,
        name: selection.name,
        path: selection.path,
        updatedAt: nextMetadata[slot]?.updatedAt ?? Date.now(),
        source: selection.source
      });
    } else {
      await deleteRecord(slot);
    }
  }

  notifySelectionChange();
};

export const clearFolderSelection = async (slot: FolderSlot) => {
  const metadata = readMetadata();
  const nextMetadata = { ...metadata };
  delete nextMetadata[slot];

  writeMetadata(nextMetadata);
  handleCache.delete(slot);
  const nextTreeSnapshot = { ...readTreeSnapshot() };
  delete nextTreeSnapshot[slot];
  writeTreeSnapshot(nextTreeSnapshot);

  if (slot === 'source') {
    writeScopeSnapshot(null);
  }

  await deleteRecord(slot);
  notifySelectionChange();
};

export const isImportStepComplete = () => isImportStepCompleteFromMetadata(readMetadata());

export const subscribeFolderSelectionChanges = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => {
      // No-op on non-browser environments.
    };
  }

  const handleCustomUpdate = () => callback();
  const handleStorageUpdate = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener(STORAGE_EVENT_NAME, handleCustomUpdate);
  window.addEventListener('storage', handleStorageUpdate);

  return () => {
    window.removeEventListener(STORAGE_EVENT_NAME, handleCustomUpdate);
    window.removeEventListener('storage', handleStorageUpdate);
  };
};

export const getDefaultFolderSelections = createEmptyState;

export const saveSourceTreeSnapshot = (slot: FolderSlot, root: SourceTreeDirectoryNode) => {
  const snapshot = readTreeSnapshot();
  snapshot[slot] = root;
  writeTreeSnapshot(snapshot);
  notifySelectionChange();
};

export const loadSourceTreeSnapshot = (slot: FolderSlot): SourceTreeDirectoryNode | null => {
  const snapshot = readTreeSnapshot();

  return snapshot[slot] ?? null;
};

export const clearSourceTreeSnapshot = (slot: FolderSlot) => {
  const snapshot = readTreeSnapshot();
  delete snapshot[slot];
  writeTreeSnapshot(snapshot);
};

export const saveSourceSelectionScope = (scope: Omit<SourceSelectionScopeSnapshot, 'updatedAt'>) => {
  writeScopeSnapshot({
    ...scope,
    updatedAt: Date.now()
  });
  notifySelectionChange();
};

export const loadSourceSelectionScope = (): SourceSelectionScopeSnapshot | null => readScopeSnapshot();

export const clearSourceSelectionScope = () => {
  writeScopeSnapshot(null);
  notifySelectionChange();
};

export const clearFolderSelectionPersistence = async () => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(TREE_STORAGE_KEY);
    window.localStorage.removeItem(SCOPE_STORAGE_KEY);
  } catch {
    // Ignore storage failures and continue clearing other stores.
  }

  handleCache.clear();
  closeAllDatabaseConnections();

  if (typeof window === 'undefined' || !window.indexedDB) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(DATABASE_NAME);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  }).catch(() => {
    // If the database is busy, we still consider the browser cache cleared enough for the reset flow.
  });
};

export const loadFolderSelectionHandle = async (slot: FolderSlot): Promise<FileSystemDirectoryHandle | null> => {
  const cachedHandle = handleCache.get(slot);

  if (cachedHandle) {
    return cachedHandle;
  }

  const record = await readRecord(slot);

  return record?.handle ?? null;
};
