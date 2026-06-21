import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { normalizeWebAssetPath } from '../src/pathSecurity.js';
import { resolveDesktopRuntimePaths } from '../src/runtimePaths.js';

test('web assets stay inside the packaged web root', () => {
  const root = path.resolve('C:\\runtime\\web');
  assert.equal(normalizeWebAssetPath(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'));
  assert.equal(normalizeWebAssetPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(normalizeWebAssetPath(root, '/..%2Fsecrets.txt'), null);
});

test('development runtime keeps durable data in userData', () => {
  const fakeApp = {
    isPackaged: false,
    getAppPath: () => 'C:\\repo',
    getPath: () => 'C:\\Users\\test\\AppData\\Roaming\\Media Organizer'
  };
  const paths = resolveDesktopRuntimePaths(fakeApp as never);
  assert.equal(paths.dataDir, path.join(fakeApp.getPath(), 'data'));
  assert.equal(paths.workerPath, null);
  assert.match(paths.webRoot, /apps[\\/]web[\\/]dist$/);
});
