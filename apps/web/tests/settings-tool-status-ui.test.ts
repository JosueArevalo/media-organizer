import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const settingsSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src', 'pages', 'SettingsPage.tsx'),
  'utf8'
);

test('missing tool status combines status and install guidance in one card', () => {
  assert.match(settingsSource, /status-with-details/);
  assert.match(settingsSource, /status-details/);
  assert.match(settingsSource, /snapshot\.installCommand/);
  assert.match(settingsSource, /snapshot\.note/);
  assert.doesNotMatch(settingsSource, /renderInstallHint/);
  assert.doesNotMatch(settingsSource, /tool-install-hint/);
});
