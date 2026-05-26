import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { validateImportFolders } from '../src/pipeline/import/importValidation.service.js';

let tempRoot = '';

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-import-validation-test-'));
});

afterEach(() => {
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('validateImportFolders rejects a missing source', async () => {
  const destinationDir = path.join(tempRoot, 'Output');
  fs.mkdirSync(destinationDir);

  const result = await validateImportFolders(path.join(tempRoot, 'Missing'), destinationDir);

  assert.deepEqual(result, {
    ok: false,
    code: 'source_not_found',
    message: 'Source folder does not exist.'
  });
});

test('validateImportFolders rejects a source that is not a directory', async () => {
  const sourceFile = path.join(tempRoot, 'source.txt');
  const destinationDir = path.join(tempRoot, 'Output');
  fs.writeFileSync(sourceFile, 'fake source');
  fs.mkdirSync(destinationDir);

  const result = await validateImportFolders(sourceFile, destinationDir);

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'source_not_directory');
});

test('validateImportFolders rejects identical source and destination paths', async () => {
  const sourceDir = path.join(tempRoot, 'Input');
  fs.mkdirSync(sourceDir);

  const result = await validateImportFolders(sourceDir, sourceDir);

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'same_path');
});

test('validateImportFolders rejects a destination directly inside the source', async () => {
  const sourceDir = path.join(tempRoot, 'Input');
  fs.mkdirSync(sourceDir);

  const result = await validateImportFolders(sourceDir, path.join(sourceDir, 'Output'));

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'destination_inside_source');
});

test('validateImportFolders rejects a destination nested inside the source', async () => {
  const sourceDir = path.join(tempRoot, 'Input');
  fs.mkdirSync(sourceDir);

  const result = await validateImportFolders(sourceDir, path.join(sourceDir, 'Nested', 'Output'));

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'destination_inside_source');
});

test('validateImportFolders allows sibling source and destination folders', async () => {
  const sourceDir = path.join(tempRoot, 'Input');
  const destinationDir = path.join(tempRoot, 'Output');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(destinationDir);

  const result = await validateImportFolders(sourceDir, destinationDir);

  assert.deepEqual(result, { ok: true });
});

test('validateImportFolders allows a missing destination when its parent is writable', async () => {
  const sourceDir = path.join(tempRoot, 'Input');
  fs.mkdirSync(sourceDir);

  const result = await validateImportFolders(sourceDir, path.join(tempRoot, 'Output'));

  assert.deepEqual(result, { ok: true });
  assert.equal(fs.existsSync(path.join(tempRoot, 'Output')), false);
});

test('validateImportFolders rejects a destination that exists as a file', async () => {
  const sourceDir = path.join(tempRoot, 'Input');
  const destinationFile = path.join(tempRoot, 'output.txt');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(destinationFile, 'fake destination');

  const result = await validateImportFolders(sourceDir, destinationFile);

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'destination_not_directory');
});
