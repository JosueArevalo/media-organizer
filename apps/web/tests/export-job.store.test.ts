import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  loadExportJobSnapshot,
  resetExportJobSnapshot,
  saveExportJobSnapshot,
  type ExportJobSnapshot
} from '../src/services/export-job.store';
import type { ExportTargetType } from '../src/services/export.service';

const storage = new Map<string, string>();

class TestCustomEvent extends Event {
  constructor(type: string) {
    super(type);
  }
}

const installBrowserStorage = () => {
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  };

  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: TestCustomEvent
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true
    }
  });
};

const createSnapshot = (targetType: ExportTargetType, updatedAt: number): ExportJobSnapshot => ({
  backendJobId: `${targetType}-job`,
  status: 'paused',
  sourceRoot: 'D:\\Output',
  groupingSessionId: 'grouping-1',
  destinationPath: targetType === 'network-folder' ? '\\\\server\\share' : 'user@example.com',
  googlePhotosAccountId: targetType === 'google-photos' ? 'account-1' : null,
  targetType,
  totalItems: 3,
  startedAt: 1,
  completedAt: null,
  errorMessage: null,
  updatedAt
});

afterEach(() => {
  storage.clear();
  Reflect.deleteProperty(globalThis, 'CustomEvent');
  Reflect.deleteProperty(globalThis, 'window');
});

test('keeps independent active snapshots for each export provider', () => {
  installBrowserStorage();
  saveExportJobSnapshot(createSnapshot('google-photos', 1));
  saveExportJobSnapshot(createSnapshot('network-folder', 2));

  assert.equal(loadExportJobSnapshot('google-photos').backendJobId, 'google-photos-job');
  assert.equal(loadExportJobSnapshot('google-photos').totalItems, 3);
  assert.equal(loadExportJobSnapshot('network-folder').backendJobId, 'network-folder-job');
  assert.equal(loadExportJobSnapshot().targetType, 'network-folder');
});

test('does not restore a provider snapshot for another session or source root', () => {
  installBrowserStorage();
  saveExportJobSnapshot(createSnapshot('google-photos', 1));

  assert.equal(loadExportJobSnapshot('google-photos', {
    groupingSessionId: 'grouping-2',
    sourceRoot: 'D:\\Output'
  }).status, 'idle');
  assert.equal(loadExportJobSnapshot('google-photos', {
    groupingSessionId: 'grouping-1',
    sourceRoot: 'D:\\Other'
  }).status, 'idle');
});

test('migrates the legacy global snapshot to its recorded provider', () => {
  installBrowserStorage();
  storage.set('media-organizer-export-job', JSON.stringify(createSnapshot('google-photos', 1)));

  assert.equal(loadExportJobSnapshot('google-photos').backendJobId, 'google-photos-job');
  assert.equal(loadExportJobSnapshot('network-folder').status, 'idle');
  assert.equal(storage.has('media-organizer-export-job'), false);
  assert.equal(storage.has('media-organizer-export-jobs'), true);
});

test('resetting Google Photos keeps the Network Folder snapshot', () => {
  installBrowserStorage();
  saveExportJobSnapshot(createSnapshot('google-photos', 1));
  saveExportJobSnapshot(createSnapshot('network-folder', 2));

  resetExportJobSnapshot('google-photos');

  assert.equal(loadExportJobSnapshot('google-photos').status, 'idle');
  assert.equal(loadExportJobSnapshot('network-folder').backendJobId, 'network-folder-job');
});
