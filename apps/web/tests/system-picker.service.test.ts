import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { pickDirectoryRequest, pickFileRequest } from '../src/services/system-picker.service';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockJsonFetch = (status: number, payload: unknown) => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
};

test('pickDirectoryRequest returns selected paths from the backend picker', async () => {
  mockJsonFetch(200, {
    status: 'selected',
    path: 'D:\\Fotos\\Input',
    name: 'Input'
  });

  const result = await pickDirectoryRequest({ title: 'Choose source folder' });

  assert.deepEqual(result, {
    status: 'selected',
    path: 'D:\\Fotos\\Input',
    name: 'Input'
  });
});

test('pickDirectoryRequest returns unsupported for picker fallback mode', async () => {
  mockJsonFetch(501, {
    status: 'unsupported',
    message: 'Paste the path manually.'
  });

  const result = await pickDirectoryRequest({ title: 'Choose destination folder' });

  assert.deepEqual(result, {
    status: 'unsupported',
    message: 'Paste the path manually.'
  });
});

test('pickFileRequest preserves cancelled responses', async () => {
  mockJsonFetch(200, { status: 'cancelled' });

  const result = await pickFileRequest({
    title: 'Choose HandBrakeCLI executable',
    filters: [{ name: 'Executable files', extensions: ['exe'] }]
  });

  assert.deepEqual(result, { status: 'cancelled' });
});
