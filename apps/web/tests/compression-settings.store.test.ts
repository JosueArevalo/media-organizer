import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { loadCompressionSettings, saveCompressionSettings } from '../src/services/compression-settings.store';

const storage = new Map<string, string>();

const installLocalStorage = () => {
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage }
  });
};

afterEach(() => {
  storage.clear();
  Reflect.deleteProperty(globalThis, 'window');
});

test('loadCompressionSettings returns defaults without localStorage data', () => {
  installLocalStorage();

  const settings = loadCompressionSettings();

  assert.equal(settings.imagePreset, 'balanced');
  assert.equal(settings.customQuality, 72);
  assert.equal(settings.videoPreset, 'Fast 1080p30');
  assert.equal(settings.updatedAt, 0);
});

test('saveCompressionSettings persists custom quality choices', () => {
  installLocalStorage();

  saveCompressionSettings({
    imagePreset: 'custom',
    customQuality: 73,
    videoPreset: 'HQ 1080p30 Surround'
  });

  const settings = loadCompressionSettings();

  assert.equal(settings.imagePreset, 'custom');
  assert.equal(settings.customQuality, 73);
  assert.equal(settings.videoPreset, 'HQ 1080p30 Surround');
  assert.ok(settings.updatedAt > 0);
});

test('loadCompressionSettings normalizes invalid custom quality values', () => {
  installLocalStorage();
  storage.set('media-organizer-compression-settings', JSON.stringify({
    imagePreset: 'custom',
    customQuality: 173,
    videoPreset: 'Fast 720p30'
  }));

  const settings = loadCompressionSettings();

  assert.equal(settings.imagePreset, 'custom');
  assert.equal(settings.customQuality, 100);
  assert.equal(settings.videoPreset, 'Fast 720p30');
});
