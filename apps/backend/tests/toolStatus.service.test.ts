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

test('resolveToolCommand discovers known tools under a Linuxbrew prefix outside PATH', () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-linuxbrew-'));
  const commands = [
    path.join(prefix, 'opt', 'mozjpeg', 'bin', 'cjpeg'),
    path.join(prefix, 'bin', 'magick'),
    path.join(prefix, 'bin', 'exiftool'),
    path.join(prefix, 'bin', 'HandBrakeCLI')
  ];

  for (const command of commands) {
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.writeFileSync(command, 'fake tool', 'utf8');
  }

  const options = {
    platform: 'linux' as const,
    env: { PATH: '' },
    homebrewPrefixes: [prefix]
  };

  assert.equal(resolveToolCommand('cjpeg', options), commands[0]);
  assert.equal(resolveToolCommand('magick', options), commands[1]);
  assert.equal(resolveToolCommand('exiftool', options), commands[2]);
  assert.equal(resolveToolCommand('HandBrakeCLI', options), commands[3]);
});

test('resolveToolCommand supports Apple Silicon and Intel Homebrew prefixes', () => {
  for (const architecture of ['apple-silicon', 'intel']) {
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), `media-organizer-${architecture}-brew-`));
    const command = path.join(prefix, 'opt', 'mozjpeg', 'bin', 'cjpeg');
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.writeFileSync(command, 'fake tool', 'utf8');

    assert.equal(resolveToolCommand('cjpeg', {
      platform: 'darwin',
      env: { PATH: '' },
      homebrewPrefixes: [prefix]
    }), command);
  }
});

test('resolveToolCommand does not replace an invalid explicit path with an automatic match', () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-explicit-tool-'));
  const command = path.join(prefix, 'bin', 'magick');
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.writeFileSync(command, 'fake tool', 'utf8');

  assert.equal(resolveToolCommand(path.join(prefix, 'missing', 'magick'), {
    platform: 'linux',
    env: { PATH: '' },
    homebrewPrefixes: [prefix]
  }), null);
});

test('resolveToolCommand keeps Homebrew fallback disabled on Windows', () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-windows-tool-'));
  const command = path.join(prefix, 'bin', 'magick');
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.writeFileSync(command, 'fake tool', 'utf8');

  assert.equal(resolveToolCommand('magick', {
    platform: 'win32',
    env: { PATH: '' },
    homebrewPrefixes: [prefix]
  }), null);
});

test('getToolsStatus uses Unix command defaults and keeps empty Windows tools unconfigured', () => {
  const unixStatus = getToolsStatus({}, 'darwin');
  assert.equal(unixStatus.tools.image.effectiveCommand, 'cjpeg');
  assert.equal(unixStatus.tools.imagemagick.effectiveCommand, 'magick');
  assert.equal(unixStatus.tools.exiftool.effectiveCommand, 'exiftool');
  assert.equal(unixStatus.tools.video.effectiveCommand, 'HandBrakeCLI');
  assert.equal(unixStatus.tools.image.installCommand, 'brew install mozjpeg');
  assert.match(unixStatus.tools.image.note ?? '', /Apple Silicon/);

  const linuxStatus = getToolsStatus({}, 'linux');
  assert.match(linuxStatus.tools.image.note ?? '', /\/home\/linuxbrew\/\.linuxbrew/);
  assert.doesNotMatch(linuxStatus.tools.image.note ?? '', /\/opt\/homebrew/);

  const windowsStatus = getToolsStatus({}, 'win32');
  for (const tool of Object.values(windowsStatus.tools)) {
    assert.equal(tool.effectiveCommand, '');
    assert.equal(tool.resolvedPath, null);
    assert.equal(tool.status, 'missing');
  }
  assert.equal(windowsStatus.tools.image.installCommand, null);
});
