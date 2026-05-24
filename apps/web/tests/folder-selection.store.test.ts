import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { loadSourceSelectionScope, saveSourceSelectionScope } from '../src/services/folder-selection.store';

const storage = new Map<string, string>();

class TestCustomEvent extends Event {
  detail: unknown;

  constructor(type: string, init?: CustomEventInit) {
    super(type);
    this.detail = init?.detail;
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

afterEach(() => {
  storage.clear();
  Reflect.deleteProperty(globalThis, 'CustomEvent');
  Reflect.deleteProperty(globalThis, 'window');
});

test('source selection scope persists exclusions, active preset, mode, and expanded directories', () => {
  installBrowserStorage();

  saveSourceSelectionScope({
    excludedDirectories: ['Camera/Screenshots'],
    excludedFiles: ['Camera/IMG_001.jpg'],
    includedDirectories: ['Camera/Screenshots/Keep'],
    includedFiles: ['Camera/Screenshots/Keep/IMG_002.jpg'],
    activePreset: 'custom',
    mode: 'directories',
    expandedDirectories: ['Camera', 'Camera/Screenshots']
  });

  const scope = loadSourceSelectionScope();

  assert.deepEqual(scope?.excludedDirectories, ['Camera/Screenshots']);
  assert.deepEqual(scope?.excludedFiles, ['Camera/IMG_001.jpg']);
  assert.deepEqual(scope?.includedDirectories, ['Camera/Screenshots/Keep']);
  assert.deepEqual(scope?.includedFiles, ['Camera/Screenshots/Keep/IMG_002.jpg']);
  assert.equal(scope?.activePreset, 'custom');
  assert.equal(scope?.mode, 'directories');
  assert.deepEqual(scope?.expandedDirectories, ['Camera', 'Camera/Screenshots']);
  assert.ok((scope?.updatedAt ?? 0) > 0);
});

test('source selection scope supports old snapshots without UI metadata', () => {
  installBrowserStorage();
  storage.set('media-organizer-source-scope', JSON.stringify({
    excludedDirectories: ['WhatsApp'],
    excludedFiles: [],
    includedDirectories: [],
    includedFiles: [],
    updatedAt: 123
  }));

  const scope = loadSourceSelectionScope();

  assert.deepEqual(scope?.excludedDirectories, ['WhatsApp']);
  assert.equal(scope?.activePreset, undefined);
  assert.equal(scope?.mode, undefined);
  assert.equal(scope?.expandedDirectories, undefined);
  assert.equal(scope?.updatedAt, 123);
});
