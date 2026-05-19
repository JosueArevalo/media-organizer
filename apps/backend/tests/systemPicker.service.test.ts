import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isAllowedPickerOrigin,
  pickDirectory,
  pickFile,
  type PickerDeps,
  type PickerProcessResult
} from '../src/system/systemPicker.service.js';

const createDeps = (
  platform: NodeJS.Platform,
  result: PickerProcessResult
): PickerDeps => ({
  platform,
  runProcess: async () => result
});

test('pickDirectory returns cancelled when the native dialog is dismissed', async () => {
  const result = await pickDirectory(
    { title: 'Choose folder' },
    createDeps('win32', {
      status: 'exited',
      exitCode: 2,
      stdout: '',
      stderr: ''
    })
  );

  assert.deepEqual(result, { status: 'cancelled' });
});

test('pickFile normalizes selected paths and exposes the basename', async () => {
  const result = await pickFile(
    { title: 'Choose file' },
    createDeps('win32', {
      status: 'exited',
      exitCode: 0,
      stdout: 'C:\\Tools\\HandBrakeCLI.exe\r\n',
      stderr: ''
    })
  );

  assert.deepEqual(result, {
    status: 'selected',
    path: 'C:\\Tools\\HandBrakeCLI.exe',
    name: 'HandBrakeCLI.exe'
  });
});

test('pickDirectory reports unsupported on Linux when no native picker command exists', async () => {
  const result = await pickDirectory(
    { title: 'Choose folder' },
    createDeps('linux', {
      status: 'error',
      code: 'ENOENT',
      message: 'command not found'
    })
  );

  assert.equal(result.status, 'unsupported');
  assert.match(result.status === 'unsupported' ? result.message : '', /zenity|kdialog/i);
});

test('picker origins are limited to local app origins', () => {
  assert.equal(isAllowedPickerOrigin(undefined), true);
  assert.equal(isAllowedPickerOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedPickerOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedPickerOrigin('http://[::1]:5173'), true);
  assert.equal(isAllowedPickerOrigin('https://example.com'), false);
  assert.equal(isAllowedPickerOrigin('not a url'), false);
});
