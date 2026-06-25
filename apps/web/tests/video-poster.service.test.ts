import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const serviceSource = fs.readFileSync(path.resolve('src/services/video-poster.service.ts'), 'utf8');

test('video poster generation is bounded, temporary, and cached', () => {
  assert.match(serviceSource, /MAX_CONCURRENT_POSTERS = 2/);
  assert.match(serviceSource, /POSTER_TIMEOUT_MS = 8_000/);
  assert.match(serviceSource, /const posterCache = new Map<string, string>/);
  assert.match(serviceSource, /const pendingTasks: PosterTask\[\] = \[\]/);
  assert.match(serviceSource, /fetch\(url\)/);
  assert.match(serviceSource, /URL\.createObjectURL\(await response\.blob\(\)\)/);
  assert.match(serviceSource, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(serviceSource, /getPosterSeekTime/);
  assert.match(serviceSource, /loadedmetadata/);
  assert.match(serviceSource, /seeked/);
  assert.match(serviceSource, /cleanupVideo\(video\)/);
  assert.match(serviceSource, /fallbackUrl/);
});
