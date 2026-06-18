import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveToolCommand } from '../src/pipeline/compression/toolCommandResolver.js';
import { getToolsStatus } from '../src/system/toolStatus.service.js';

test('resolveToolCommand resolves absolute files and commands from PATH', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-tool-resolve-'));
  const toolPath = path.join(tempRoot, process.platform === 'win32' ? 'tool.cmd' : 'tool');
  fs.writeFileSync(toolPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/usr/bin/env sh\n', 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(toolPath, 0o755);
  }

  assert.equal(resolveToolCommand(toolPath), toolPath);
  assert.ok(resolveToolCommand('node'));
});

test('getToolsStatus uses Unix command defaults and Windows executable defaults', () => {
  const unixStatus = getToolsStatus({}, 'darwin');
  assert.equal(unixStatus.tools.image.effectiveCommand, 'cjpeg');
  assert.equal(unixStatus.tools.imagemagick.effectiveCommand, 'magick');
  assert.equal(unixStatus.tools.exiftool.effectiveCommand, 'exiftool');
  assert.equal(unixStatus.tools.video.effectiveCommand, 'HandBrakeCLI');
  assert.equal(unixStatus.tools.image.installCommand, 'brew install mozjpeg');

  const windowsStatus = getToolsStatus({}, 'win32');
  assert.equal(windowsStatus.tools.image.effectiveCommand, 'cjpeg-static.exe');
  assert.equal(windowsStatus.tools.video.effectiveCommand, 'HandBrakeCLI.exe');
  assert.equal(windowsStatus.tools.image.installCommand, null);
});
