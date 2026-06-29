import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { EncoderSettingsSnapshot } from '../src/services/encoder-settings.store';
import {
  getEffectiveToolCommand,
  isUnixPlatform,
  isWindowsPlatform,
  loadToolsStatusRequest,
  type ToolsStatusSnapshot
} from '../src/services/tool-status.service';

const originalFetch = globalThis.fetch;

const emptySettings: EncoderSettingsSnapshot = {
  imageToolCommand: '',
  pngToolCommand: '',
  videoToolCommand: '',
  imageMagickCommand: '',
  exifToolCommand: '',
  updatedAt: 0
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('Windows keeps empty tool settings unconfigured', () => {
  assert.equal(isWindowsPlatform('win32'), true);
  assert.equal(isUnixPlatform('win32'), false);
  assert.equal(getEffectiveToolCommand('image', emptySettings, 'win32'), '');
  assert.equal(getEffectiveToolCommand('png', emptySettings, 'win32'), '');
  assert.equal(getEffectiveToolCommand('imagemagick', emptySettings, 'win32'), '');
  assert.equal(getEffectiveToolCommand('exiftool', emptySettings, 'win32'), '');
  assert.equal(getEffectiveToolCommand('video', emptySettings, 'win32'), '');
});

test('macOS uses commands from PATH when settings are empty', () => {
  assert.equal(isUnixPlatform('darwin'), true);
  assert.equal(getEffectiveToolCommand('image', emptySettings, 'darwin'), 'cjpeg');
  assert.equal(getEffectiveToolCommand('imagemagick', emptySettings, 'darwin'), 'magick');
  assert.equal(getEffectiveToolCommand('png', emptySettings, 'darwin'), 'pngquant');
  assert.equal(getEffectiveToolCommand('exiftool', emptySettings, 'darwin'), 'exiftool');
  assert.equal(getEffectiveToolCommand('video', emptySettings, 'darwin'), 'HandBrakeCLI');
});

test('Linux uses the same PATH commands as macOS', () => {
  assert.equal(isUnixPlatform('linux'), true);
  assert.equal(getEffectiveToolCommand('image', emptySettings, 'linux'), 'cjpeg');
  assert.equal(getEffectiveToolCommand('video', emptySettings, 'linux'), 'HandBrakeCLI');
  assert.equal(getEffectiveToolCommand('png', emptySettings, 'linux'), 'pngquant');
});

test('configured commands override platform defaults', () => {
  const settings = {
    ...emptySettings,
    imageToolCommand: ' /opt/homebrew/bin/cjpeg '
  };

  assert.equal(getEffectiveToolCommand('image', settings, 'darwin'), '/opt/homebrew/bin/cjpeg');
  assert.equal(getEffectiveToolCommand('image', settings, 'win32'), '/opt/homebrew/bin/cjpeg');
});

test('loadToolsStatusRequest posts encoder commands and returns the snapshot', async () => {
  const snapshot = {
    platform: 'darwin',
    python: {
      command: 'python3',
      resolvedPath: '/usr/bin/python3',
      status: 'ready',
      candidates: ['python3', 'python']
    },
    tools: {}
  } as unknown as ToolsStatusSnapshot;
  let request: { input: string; init?: RequestInit } | null = null;

  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const result = await loadToolsStatusRequest(emptySettings);

  assert.deepEqual(result, snapshot);
  assert.equal(request?.input, '/api/system/tools/status');
  assert.equal(request?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    imageToolCommand: '',
    pngToolCommand: '',
    imageMagickCommand: '',
    exifToolCommand: '',
    videoToolCommand: ''
  });
});
