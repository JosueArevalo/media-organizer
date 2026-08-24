import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { buildDesktopSmokeProbeScript } from '../src/desktopSmoke.js';
import { resolveDesktopExecutable } from '../../../scripts/desktop-smoke-utils.mjs';

test('prefers the packaged executable passed through --executable', () => {
  const resolved = resolveDesktopExecutable({
    argv: ['--executable', '.\\release\\Media Organizer.exe'],
    workingDirectory: 'C:\\repo',
    electronResolver: () => 'C:\\ignored\\electron.exe'
  });

  assert.equal(resolved.source, 'portable');
  assert.equal(resolved.portableExecutable, path.resolve('C:\\repo', '.\\release\\Media Organizer.exe'));
  assert.equal(resolved.executable, resolved.portableExecutable);
});

test('uses the electron package resolver when no packaged executable is provided', () => {
  const resolved = resolveDesktopExecutable({
    argv: [],
    workingDirectory: 'C:\\repo',
    electronResolver: () => 'C:\\Users\\runner\\AppData\\Local\\electron\\electron.exe'
  });

  assert.equal(resolved.source, 'development');
  assert.equal(resolved.portableExecutable, null);
  assert.equal(resolved.executable, 'C:\\Users\\runner\\AppData\\Local\\electron\\electron.exe');
});

test('desktop smoke probe waits for an explicit renderer-ready signal', () => {
  const script = buildDesktopSmokeProbeScript({
    marker: 'persisted',
    timeoutMs: 4321,
    pollIntervalMs: 25
  });

  assert.match(script, /__mediaOrganizerReady/);
  assert.match(script, /__mediaOrganizerBootstrapFailed/);
  assert.match(script, /Renderer did not become ready before the smoke probe timed out\./);
  assert.match(script, /window\.setTimeout\(resolve, 25\)/);
  assert.match(script, /Date\.now\(\) \+ 4321/);
  assert.match(script, /localStorage\.setItem\('media-organizer:desktop-smoke', "persisted"\)/);
});
