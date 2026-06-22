import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { isTrustedDesktopUrl } from '../src/ipcSecurity.js';

test('desktop IPC accepts only the stable application origin', () => {
  assert.equal(isTrustedDesktopUrl('media-organizer://app/settings'), true);
  assert.equal(isTrustedDesktopUrl('media-organizer://evil/settings'), false);
  assert.equal(isTrustedDesktopUrl('https://app/settings'), false);
  assert.equal(isTrustedDesktopUrl('not a URL'), false);
});

test('preload exposes sustained backend health reporting', () => {
  const source = fs.readFileSync(path.resolve('src', 'preload.cts'), 'utf8');
  assert.match(source, /reportBackendUnresponsive/);
});
