import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

type ScriptItem = {
  error?: string | null;
  status: 'completed' | 'failed';
};

const repoRoot = path.resolve(process.cwd(), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'media_tools', 'compress_images.py');

test('compress_images reports missing oriented JPEG helper script without blaming mozjpeg', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-helper-missing-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  await sharp({
    create: {
      width: 720,
      height: 480,
      channels: 3,
      background: { r: 32, g: 96, b: 160 }
    }
  })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 90 })
    .toFile(path.join(sourceDir, 'portrait.jpg'));

  const result = spawnSync(process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python', [
    scriptPath,
    '--source-dir', sourceDir,
    '--output-dir', outputDir,
    '--quality', '80',
    '--encoder-command', '__missing_cjpeg__',
    '--oriented-jpeg-helper-command', process.execPath,
    '--oriented-jpeg-helper-script', path.join(tempRoot, 'missing-helper.js')
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const complete = result.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.status, 'failed');
  assert.match(item?.error ?? '', /Oriented JPEG helper script not found/);
  assert.doesNotMatch(item?.error ?? '', /Image encoder command not found/);
});
