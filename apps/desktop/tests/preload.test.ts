import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

test('sandbox preload is authored and loaded as CommonJS', () => {
  const sourceRoot = path.resolve('src');
  const main = fs.readFileSync(path.join(sourceRoot, 'main.ts'), 'utf8');
  assert.equal(fs.existsSync(path.join(sourceRoot, 'preload.cts')), true);
  assert.equal(fs.existsSync(path.join(sourceRoot, 'preload.ts')), false);
  assert.match(main, /preload\.cjs/);
});
