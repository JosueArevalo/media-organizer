import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const compressionPagePath = path.join(process.cwd(), 'src', 'pages', 'CompressionPage.tsx');

test('CompressionPage renders MP4 output option before preserve option in source order', () => {
  const source = fs.readFileSync(compressionPagePath, 'utf8');
  const mp4Index = source.indexOf("checked={videoOutputFormatMode === 'mp4'}");
  const preserveIndex = source.indexOf("checked={videoOutputFormatMode === 'preserve'}");

  assert.notEqual(mp4Index, -1);
  assert.notEqual(preserveIndex, -1);
  assert.ok(mp4Index < preserveIndex);
});
