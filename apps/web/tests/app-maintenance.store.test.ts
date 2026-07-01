import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { resetAllPersistentAppState } from '../src/services/app-maintenance.store';

const storage = new Map<string, string>();
const originalCustomEvent = globalThis.CustomEvent;

const installWindow = () => {
  const localStorage = {
    get length() {
      return storage.size;
    },
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => Array.from(storage.keys())[index] ?? null
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true
    }
  });

  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class CustomEvent {
      type: string;

      constructor(type: string) {
        this.type = type;
      }
    }
  });
};

afterEach(() => {
  storage.clear();
  Reflect.deleteProperty(globalThis, 'window');
  if (originalCustomEvent) {
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      value: originalCustomEvent
    });
  } else {
    Reflect.deleteProperty(globalThis, 'CustomEvent');
  }
});

test('resetAllPersistentAppState clears onboarding and preserves exempt preferences', async () => {
  installWindow();
  storage.set('media-organizer-dashboard-onboarding', JSON.stringify({ dismissedAt: 123, version: 1 }));
  storage.set('media-organizer-compression-settings', JSON.stringify({ imagePreset: 'balanced' }));
  storage.set('encoderSettings', JSON.stringify({ imageToolCommand: 'cjpeg-static.exe' }));
  storage.set('media-organizer-notification-settings', JSON.stringify({ soundEnabled: true }));

  await resetAllPersistentAppState();

  assert.equal(storage.has('media-organizer-dashboard-onboarding'), false);
  assert.equal(storage.get('encoderSettings'), JSON.stringify({ imageToolCommand: 'cjpeg-static.exe' }));
  assert.equal(storage.get('media-organizer-notification-settings'), JSON.stringify({ soundEnabled: true }));
});
