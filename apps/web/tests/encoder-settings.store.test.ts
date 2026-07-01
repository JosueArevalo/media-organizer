import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { loadEncoderSettings, saveEncoderSettings } from '../src/services/encoder-settings.store';

const storage = new Map<string, string>();

const installLocalStorage = () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    }
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  });
};

afterEach(() => {
  storage.clear();
  Reflect.deleteProperty(globalThis, 'localStorage');
  Reflect.deleteProperty(globalThis, 'window');
});

test('loadEncoderSettings backfills new optional tool paths for old snapshots', async () => {
  installLocalStorage();
  storage.set('encoderSettings', JSON.stringify({
    imageToolCommand: 'cjpeg-static.exe',
    videoToolCommand: 'HandBrakeCLI.exe',
    updatedAt: 123
  }));

  const settings = await loadEncoderSettings();

  assert.equal(settings.imageToolCommand, 'cjpeg-static.exe');
  assert.equal(settings.pngToolCommand, '');
  assert.equal(settings.videoToolCommand, 'HandBrakeCLI.exe');
  assert.equal(settings.imageMagickCommand, '');
  assert.equal(settings.exifToolCommand, '');
  assert.equal(settings.updatedAt, 123);
});

test('saveEncoderSettings persists all four external tool paths', async () => {
  installLocalStorage();

  await saveEncoderSettings({
    imageToolCommand: 'cjpeg-static.exe',
    pngToolCommand: 'pngquant.exe',
    videoToolCommand: 'HandBrakeCLI.exe',
    imageMagickCommand: 'magick.exe',
    exifToolCommand: 'exiftool.exe'
  });

  const stored = JSON.parse(storage.get('encoderSettings') ?? '{}') as {
    imageToolCommand?: string;
    pngToolCommand?: string;
    videoToolCommand?: string;
    imageMagickCommand?: string;
    exifToolCommand?: string;
  };

  assert.equal(stored.imageToolCommand, 'cjpeg-static.exe');
  assert.equal(stored.pngToolCommand, 'pngquant.exe');
  assert.equal(stored.videoToolCommand, 'HandBrakeCLI.exe');
  assert.equal(stored.imageMagickCommand, 'magick.exe');
  assert.equal(stored.exifToolCommand, 'exiftool.exe');
});
