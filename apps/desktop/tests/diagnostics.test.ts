import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readLogTail, redactDiagnostics } from '../src/diagnostics.js';
import { createDesktopLogger } from '../src/logging.js';

test('diagnostics keep the log path, tail recent lines and redact local values', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-log-'));
  const logger = createDesktopLogger(directory);
  logger.write('test', 'first');
  logger.write('test', 'C:\\Users\\josue secret-token');
  assert.match(logger.getTail(), /secret-token/);
  await new Promise<void>((resolve) => {
    logger.close();
    setTimeout(resolve, 10);
  });
  assert.equal(fs.existsSync(logger.filePath), true);
  const tail = readLogTail(logger.filePath, 1);
  assert.match(tail, /secret-token/);
  assert.equal(redactDiagnostics(tail, 'C:\\Users\\josue', 'secret-token').includes('secret-token'), false);
  assert.match(redactDiagnostics(tail, 'C:\\Users\\josue'), /%USERPROFILE%/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('desktop logger retains at most five launch logs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-rotation-'));
  for (let index = 0; index < 7; index += 1) {
    fs.writeFileSync(path.join(directory, `desktop-2026-01-0${index + 1}T00-00-00.000Z.log`), String(index));
  }
  const logger = createDesktopLogger(directory);
  logger.write('test', 'current');
  logger.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fs.readdirSync(directory).filter((name) => name.startsWith('desktop-')).length, 5);
  fs.rmSync(directory, { recursive: true, force: true });
});
