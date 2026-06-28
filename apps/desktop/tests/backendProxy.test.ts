import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackendProxyRequestInit, resolveBackendProxyTarget } from '../src/backendProxy.js';

test('GET proxy requests add authentication without a body', async () => {
  const request = new Request('https://app.test/api/health', {
    headers: { Origin: 'media-organizer://app' }
  });

  const init = await createBackendProxyRequestInit(request, 'desktop-secret');
  const headers = init.headers as Headers;
  assert.equal(init.method, 'GET');
  assert.equal(init.body, undefined);
  assert.equal(headers.get('x-media-organizer-token'), 'desktop-secret');
  assert.equal(headers.has('origin'), false);
});

test('proxy target resolves the current backend port and reports offline without one', () => {
  const url = new URL('media-organizer://app/api/health?probe=1');
  assert.equal(resolveBackendProxyTarget(null, url), null);
  assert.equal(resolveBackendProxyTarget(4100, url), 'http://127.0.0.1:4100/api/health?probe=1');
  assert.equal(resolveBackendProxyTarget(4200, url), 'http://127.0.0.1:4200/api/health?probe=1');
});

test('POST proxy requests preserve JSON bytes and recalculate content length', async () => {
  const json = JSON.stringify({ imageToolCommand: 'cjpeg', videoToolCommand: 'HandBrakeCLI' });
  const request = new Request('https://app.test/api/system/tools/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(json)),
      Origin: 'media-organizer://app'
    },
    body: json
  });

  const init = await createBackendProxyRequestInit(request, 'desktop-secret');
  const headers = init.headers as Headers;
  assert.equal(init.method, 'POST');
  assert.equal(Buffer.from(init.body as Uint8Array).toString('utf8'), json);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('x-media-organizer-token'), 'desktop-secret');
  assert.equal(headers.has('origin'), false);
  assert.equal(headers.has('content-length'), false);
});
