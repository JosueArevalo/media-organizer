import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('scanSourceTreeByPath preserves each directory name', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-scan-test-'));
  const sourceDir = path.join(tempRoot, 'Input');
  const childDir = path.join(sourceDir, 'Citroen C4');
  const nestedDir = path.join(sourceDir, 'Musica');

  fs.mkdirSync(childDir, { recursive: true });
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(childDir, 'photo.jpg'), 'x');
  fs.writeFileSync(path.join(nestedDir, 'track.mp4'), 'y');

  const { scanSourceTreeByPath } = await import('../src/pipeline/source/sourceTreeScan.service.js');
  const tree = await scanSourceTreeByPath(sourceDir);

  assert.equal(tree.name, 'Input');
  assert.deepEqual(
    tree.children.filter((child) => child.kind === 'directory').map((child) => child.name).sort(),
    ['Citroen C4', 'Musica']
  );
});