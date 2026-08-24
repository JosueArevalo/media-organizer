import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  cleanupTrackedTestTempDirectory,
  cleanupTrackedTestTempDirectories,
  createTrackedTestTempDirectory
} from '../../../test-utils/tempDirectory.js';

after(() => cleanupTrackedTestTempDirectories());

test('tracked test temporary directories are removed recursively and cleanup is idempotent', () => {
  const directory = createTrackedTestTempDirectory('media-organizer-temp-helper-test-');
  const nested = path.join(directory, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'fixture.txt'), 'fixture');

  cleanupTrackedTestTempDirectories();

  assert.equal(fs.existsSync(directory), false);
  assert.doesNotThrow(() => cleanupTrackedTestTempDirectories());
});

test('tracked test temporary directories reject unsafe prefixes', () => {
  assert.throws(() => createTrackedTestTempDirectory('temporary-test-'), /Invalid Media Organizer/);
  assert.throws(() => createTrackedTestTempDirectory('../media-organizer-test-'), /Invalid Media Organizer/);
  assert.throws(() => createTrackedTestTempDirectory('media-organizer-test'), /Invalid Media Organizer/);
});

test('cleanup rejects paths outside the temp root or not registered by this process', () => {
  assert.throws(
    () => cleanupTrackedTestTempDirectory(path.resolve('media-organizer-outside-temp')),
    /unsafe test temporary directory/
  );
  assert.throws(
    () => cleanupTrackedTestTempDirectory(path.join(path.dirname(createTrackedTestTempDirectory('media-organizer-temp-helper-owned-')), 'media-organizer-untracked')),
    /untracked test temporary directory/
  );
});
