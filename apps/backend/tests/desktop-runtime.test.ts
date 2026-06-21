import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDesktopRequestAuthorized } from '../src/http/localAccess.js';
import { getRuntimeInfo } from '../src/runtime/runtimeInfo.js';

test('desktop token is required only when configured', () => {
  assert.equal(isDesktopRequestAuthorized(undefined, undefined), true);
  assert.equal(isDesktopRequestAuthorized(undefined, 'secret'), false);
  assert.equal(isDesktopRequestAuthorized('wrong', 'secret'), false);
  assert.equal(isDesktopRequestAuthorized('secret', 'secret'), true);
});

test('runtime endpoint payload does not expose paths or credentials', () => {
  const runtime = getRuntimeInfo();
  assert.deepEqual(Object.keys(runtime).sort(), ['architecture', 'mode', 'platform', 'version']);
  assert.equal(runtime.mode, 'development');
});
