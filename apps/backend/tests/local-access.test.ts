import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  getCorsHeaders,
  hasDestructiveConfirmation,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  MAX_JSON_BODY_BYTES,
  RequestBodyTooLargeError
} from '../src/http/localAccess.js';
import { validateClearDestinationRequest } from '../src/system/maintenance.service.js';

test('local access allows localhost origins and rejects external origins', () => {
  assert.equal(isAllowedLocalOrigin(undefined), true);
  assert.equal(isAllowedLocalOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedLocalOrigin('http://[::1]:5173'), true);
  assert.equal(isAllowedLocalOrigin('https://example.com'), false);
  assert.equal(isAllowedLocalOrigin('not a url'), false);
});

test('local access allows localhost hosts and rejects LAN hosts', () => {
  assert.equal(isAllowedLocalHost(undefined), true);
  assert.equal(isAllowedLocalHost('localhost:4000'), true);
  assert.equal(isAllowedLocalHost('127.0.0.1:4000'), true);
  assert.equal(isAllowedLocalHost('[::1]:4000'), true);
  assert.equal(isAllowedLocalHost('192.168.1.20:4000'), false);
  assert.equal(isAllowedLocalHost('media-organizer.local:4000'), false);
});

test('CORS headers do not use a wildcard origin', () => {
  assert.equal(getCorsHeaders('http://127.0.0.1:5173')['Access-Control-Allow-Origin'], 'http://127.0.0.1:5173');
  assert.equal(getCorsHeaders('https://example.com')['Access-Control-Allow-Origin'], 'http://localhost:5173');
});

test('destructive operations require exact confirmation tokens', () => {
  assert.equal(hasDestructiveConfirmation({ confirmation: 'CLEAR_DESTINATION' }, 'CLEAR_DESTINATION'), true);
  assert.equal(hasDestructiveConfirmation({ confirmation: 'clear_destination' }, 'CLEAR_DESTINATION'), false);
  assert.equal(hasDestructiveConfirmation(null, 'CLEAR_DESTINATION'), false);
});

test('clear destination validation rejects missing confirmation and source-as-destination', () => {
  const destinationPath = path.resolve('tmp-output');
  const sourcePath = path.resolve('tmp-source');

  assert.deepEqual(validateClearDestinationRequest({ destinationPath }), {
    valid: false,
    status: 'invalid_request',
    message: 'confirmation must be CLEAR_DESTINATION.'
  });

  assert.deepEqual(
    validateClearDestinationRequest({
      destinationPath,
      sourcePath: destinationPath,
      confirmation: 'CLEAR_DESTINATION'
    }),
    {
      valid: false,
      status: 'invalid_request',
      message: 'Destination path cannot be the same as source path.'
    }
  );

  assert.deepEqual(
    validateClearDestinationRequest({
      destinationPath: path.join(sourcePath, 'Output'),
      sourcePath,
      confirmation: 'CLEAR_DESTINATION'
    }),
    {
      valid: false,
      status: 'invalid_request',
      message: 'Destination path cannot be inside source path.'
    }
  );
});

test('large JSON bodies are reported with a 413-ready error type', () => {
  const error = new RequestBodyTooLargeError(MAX_JSON_BODY_BYTES);

  assert.equal(error.name, 'RequestBodyTooLargeError');
  assert.match(error.message, /exceeds/);
});
