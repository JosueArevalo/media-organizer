import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  loadCompletionNotificationSettings,
  saveCompletionNotificationSettings
} from '../src/services/completion-notification-settings.store';

const storage = new Map<string, string>();

const installLocalStorage = () => {
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  });
};

afterEach(() => {
  storage.clear();
  Reflect.deleteProperty(globalThis, 'window');
});

test('loadCompletionNotificationSettings returns defaults without localStorage data', () => {
  installLocalStorage();

  const settings = loadCompletionNotificationSettings();

  assert.equal(settings.soundEnabled, true);
  assert.equal(settings.browserNotificationsEnabled, false);
  assert.equal(settings.events.compressionCompleted, true);
  assert.equal(settings.events.exportCompleted, true);
  assert.equal(settings.events.selectionLoaded, false);
  assert.equal(settings.events.groupingReorganized, false);
  assert.equal(settings.events.organizationApplied, false);
});

test('loadCompletionNotificationSettings normalizes old or invalid snapshots', () => {
  installLocalStorage();
  storage.set('media-organizer-notification-settings', JSON.stringify({
    soundEnabled: 'yes',
    browserNotificationsEnabled: true,
    events: {
      compressionCompleted: false,
      exportCompleted: 'nope'
    },
    updatedAt: 123
  }));

  const settings = loadCompletionNotificationSettings();

  assert.equal(settings.soundEnabled, true);
  assert.equal(settings.browserNotificationsEnabled, true);
  assert.equal(settings.events.compressionCompleted, false);
  assert.equal(settings.events.exportCompleted, true);
  assert.equal(settings.events.selectionLoaded, false);
  assert.equal(settings.updatedAt, 123);
});

test('saveCompletionNotificationSettings persists globals and event toggles', () => {
  installLocalStorage();

  saveCompletionNotificationSettings({
    soundEnabled: false,
    browserNotificationsEnabled: true,
    events: {
      compressionCompleted: true,
      exportCompleted: false,
      selectionLoaded: true,
      groupingReorganized: true,
      organizationApplied: false
    }
  });

  const settings = loadCompletionNotificationSettings();

  assert.equal(settings.soundEnabled, false);
  assert.equal(settings.browserNotificationsEnabled, true);
  assert.equal(settings.events.exportCompleted, false);
  assert.equal(settings.events.selectionLoaded, true);
  assert.ok(settings.updatedAt > 0);
});
