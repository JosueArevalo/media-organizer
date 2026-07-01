import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { resolveOrientedJpegHelperRuntime } from '../src/pipeline/compression/orientedJpegHelper.js';

test('resolveOrientedJpegHelperRuntime keeps tsx in source runtime', () => {
  const currentFile = path.join('D:\\repo', 'apps', 'backend', 'src', 'pipeline', 'compression', 'orientedJpegHelper.ts');
  const runtime = resolveOrientedJpegHelperRuntime({
    currentFile,
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    platform: 'win32',
    versions: process.versions
  });

  assert.match(runtime.command, /node_modules[\\/]\.bin[\\/]tsx\.cmd$/);
  assert.equal(
    runtime.scriptPath,
    path.join('D:\\repo', 'apps', 'backend', 'src', 'pipeline', 'compression', 'orientedJpegCompression.cli.ts')
  );
  assert.equal(runtime.runAsNode, false);
});

test('resolveOrientedJpegHelperRuntime points packaged runtime at backend resources and enables run-as-node for Electron', () => {
  const execPath = 'C:\\portable\\Media Organizer.exe';
  const currentFile = path.join(
    'C:\\portable',
    'resources',
    'backend',
    'dist',
    'pipeline',
    'compression',
    'orientedJpegHelper.js'
  );
  const runtime = resolveOrientedJpegHelperRuntime({
    currentFile,
    execPath,
    platform: 'win32',
    versions: { ...process.versions, electron: '42.4.1' }
  });

  assert.equal(runtime.command, execPath);
  assert.equal(
    runtime.scriptPath,
    path.join(
      'C:\\portable',
      'resources',
      'backend',
      'dist',
      'pipeline',
      'compression',
      'orientedJpegCompression.cli.js'
    )
  );
  assert.equal(runtime.runAsNode, true);
});
