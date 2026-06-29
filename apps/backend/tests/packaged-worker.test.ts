import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { buildImageCompressionCommand, buildVideoCompressionCommand } from '../src/pipeline/compression/compressionCommandBuilder.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-worker-test-'));
const worker = path.join(tempRoot, process.platform === 'win32' ? 'worker.exe' : 'worker');
fs.writeFileSync(worker, 'placeholder');
const previousWorker = process.env.MEDIA_ORGANIZER_WORKER_PATH;

after(() => {
  if (previousWorker === undefined) delete process.env.MEDIA_ORGANIZER_WORKER_PATH;
  else process.env.MEDIA_ORGANIZER_WORKER_PATH = previousWorker;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const manifest = {
  sourceDir: tempRoot,
  outputRoot: path.join(tempRoot, 'out'),
  imageOutputDir: path.join(tempRoot, 'out'),
  videoOutputDir: path.join(tempRoot, 'out'),
  imageQuality: 80,
  imageToolCommand: 'cjpeg',
  pngToolCommand: 'pngquant',
  imageMagickCommand: 'magick',
  exifToolCommand: 'exiftool',
  videoToolCommand: 'HandBrakeCLI',
  processingPolicy: { jpeg: 'compress', png: 'compress', heic: 'convert', video: 'compress' },
  videoPresetLabel: 'Fast 1080p30',
  videoOutputFormatMode: 'preserve',
  selectionScope: { excludedDirectories: [], excludedFiles: [], includedDirectories: [], includedFiles: [], updatedAt: 0 }
} as never;

test('packaged worker receives the same image and video arguments behind phase subcommands', () => {
  process.env.MEDIA_ORGANIZER_WORKER_PATH = worker;
  const images = buildImageCompressionCommand(manifest);
  const videos = buildVideoCompressionCommand(manifest);
  assert.equal(images.command, worker);
  assert.equal(images.args[0], 'images');
  assert.ok(images.args.includes('--quality'));
  assert.ok(images.args.includes('--png-command'));
  assert.equal(videos.command, worker);
  assert.equal(videos.args[0], 'videos');
  assert.ok(videos.args.includes('--preset'));
});
