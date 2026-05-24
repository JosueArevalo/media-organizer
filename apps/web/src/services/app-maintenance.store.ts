import { resetCompressionSession } from './compression-job.store';
import { resetExportJobSnapshot } from './export-job.store';
import {
  clearFolderSelectionPersistence,
  clearSourceSelectionScope,
  clearSourceTreeSnapshot
} from './folder-selection.store';
import { resetGroupingSession } from './grouping-job.store';

const APP_STORAGE_PREFIX = 'media-organizer-';
const EXEMPT_KEYS = new Set(['encoderSettings', 'media-organizer-notification-settings']);

const clearKnownLocalStorageKeys = () => {
  if (typeof window === 'undefined') {
    return;
  }

  const keysToRemove: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (!key) {
      continue;
    }

    if (EXEMPT_KEYS.has(key)) {
      continue;
    }

    if (key.startsWith(APP_STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
};

export const resetAllPersistentAppState = async () => {
  clearKnownLocalStorageKeys();
  await clearFolderSelectionPersistence();
  clearSourceSelectionScope();
  clearSourceTreeSnapshot('source');
  clearSourceTreeSnapshot('destination');
  resetCompressionSession();
  resetGroupingSession();
  resetExportJobSnapshot();
};
