import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

type ScriptItem = {
  source: string;
  output: string;
  command?: string[];
  status: 'completed' | 'failed';
  operation: 'compress' | 'copy';
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  skipped?: boolean;
  warning?: string | null;
};

const repoRoot = path.resolve(process.cwd(), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'media_tools', 'compress_images.py');
const sharpHelperCommand = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const sharpHelperScript = path.join(repoRoot, 'apps', 'backend', 'src', 'pipeline', 'compression', 'orientedJpegCompression.cli.ts');

const writeFakeTool = (toolsDir: string, name: string, script: string) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `${name}${extension}`);
  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

const createFakeTools = (toolsDir: string) => {
  const magick = process.platform === 'win32'
    ? writeFakeTool(toolsDir, 'magick-fake', `@echo off
if "%~1"=="identify" (
  echo HEIC RW
  exit /b 0
)
copy /Y "%~1" "%~5" >nul
exit /b 0
`)
    : writeFakeTool(toolsDir, 'magick-fake', `#!/usr/bin/env sh
if [ "$1" = "identify" ]; then
  echo "HEIC RW"
  exit 0
fi
cp "$1" "$5"
`);

  const cjpeg = process.platform === 'win32'
    ? writeFakeTool(toolsDir, 'cjpeg-fake', `@echo off
setlocal enabledelayedexpansion
set "out="
set "previous="
set "last="
for %%A in (%*) do (
  if "!previous!"=="-outfile" set "out=%%~A"
  set "previous=%%~A"
  set "last=%%~A"
)
copy /Y "!last!" "!out!" >nul
exit /b 0
`)
    : writeFakeTool(toolsDir, 'cjpeg-fake', `#!/usr/bin/env sh
out=""
previous=""
last=""
for arg in "$@"; do
  if [ "$previous" = "-outfile" ]; then
    out="$arg"
  fi
  previous="$arg"
  last="$arg"
done
cp "$last" "$out"
`);

  const pngquant = process.platform === 'win32'
    ? writeFakeTool(toolsDir, 'pngquant-fake', `@echo off
setlocal enabledelayedexpansion
set "out="
set "previous="
for %%A in (%*) do (
  if /I "!previous!"=="--output" set "out=%%~A"
  set "previous=%%~A"
)
for %%A in (%*) do set "last=%%~A"
copy /Y "!last!" "!out!" >nul
exit /b 0
`)
    : writeFakeTool(toolsDir, 'pngquant-fake', `#!/usr/bin/env sh
out=""
previous=""
last=""
for arg in "$@"; do
  if [ "$previous" = "--output" ]; then
    out="$arg"
  fi
  previous="$arg"
  last="$arg"
done
cp "$last" "$out"
`);

  const exiftool = process.platform === 'win32'
    ? writeFakeTool(toolsDir, 'exiftool-fake', `@echo off
echo %* > "%EXIFTOOL_ARGS_LOG%"
exit /b 0
`)
    : writeFakeTool(toolsDir, 'exiftool-fake', `#!/usr/bin/env sh
printf '%s\\n' "$*" > "$EXIFTOOL_ARGS_LOG"
`);

  return { magick, cjpeg, pngquant, exiftool };
};

const createFakeMozJpegTools = (toolsDir: string) => {
  const cjpeg = process.platform === 'win32'
    ? writeFakeTool(toolsDir, 'cjpeg', `@echo off
setlocal enabledelayedexpansion
set "out="
set "previous="
set "last="
for %%A in (%*) do (
  if "!previous!"=="-outfile" set "out=%%~A"
  set "previous=%%~A"
  set "last=%%~A"
)
if /I "!last:~-4!"==".jpg" (
  echo unrecognized input file format --- perhaps you need -targa 1>&2
  exit /b 1
)
copy /Y "!last!" "!out!" >nul
exit /b 0
`)
    : writeFakeTool(toolsDir, 'cjpeg', `#!/usr/bin/env sh
out=""
previous=""
last=""
for arg in "$@"; do
  if [ "$previous" = "-outfile" ]; then
    out="$arg"
  fi
  previous="$arg"
  last="$arg"
done
case "$last" in
  *.jpg|*.jpeg)
    echo "unrecognized input file format --- perhaps you need -targa" >&2
    exit 1
    ;;
esac
cp "$last" "$out"
`);

  const djpeg = process.platform === 'win32'
    ? writeFakeTool(toolsDir, 'djpeg', `@echo off
setlocal enabledelayedexpansion
set "out="
set "previous="
set "last="
for %%A in (%*) do (
  if "!previous!"=="-outfile" set "out=%%~A"
  set "previous=%%~A"
  set "last=%%~A"
)
copy /Y "!last!" "!out!" >nul
exit /b 0
`)
    : writeFakeTool(toolsDir, 'djpeg', `#!/usr/bin/env sh
out=""
previous=""
last=""
for arg in "$@"; do
  if [ "$previous" = "-outfile" ]; then
    out="$arg"
  fi
  previous="$arg"
  last="$arg"
done
cp "$last" "$out"
`);

  return { cjpeg, djpeg };
};

test('compress_images converts selected HEIC to JPG and compresses PNG with pngquant', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-script-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'photo.heic'), 'fake-heic', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'photo.jpg'), 'fake-jpg', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'graphic.png'), 'fake-png', 'utf8');

  const tools = createFakeTools(toolsDir);
  const pythonCommand = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';
  const result = spawnSync(
    pythonCommand,
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--quality',
      '80',
      '--encoder-command',
      tools.cjpeg,
      '--png-command',
      tools.pngquant,
      '--imagemagick-command',
      tools.magick,
      '--selection-scope-json',
      ''
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);

  const events = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; item?: ScriptItem; items?: ScriptItem[] });
  const complete = events.find((event) => event.type === 'complete');
  const items = complete?.items ?? [];
  const firstPhotoStartIndex = events.findIndex((event) => event.type === 'start' && event.item?.source.endsWith('photo.jpg'));
  const firstPhotoItemIndex = events.findIndex((event) => event.type === 'item' && event.item?.source.endsWith('photo.jpg'));
  const pngStartIndex = events.findIndex((event) => event.type === 'start' && event.item?.source.endsWith('graphic.png'));
  const pngItemIndex = events.findIndex((event) => event.type === 'item' && event.item?.source.endsWith('graphic.png'));

  assert.equal(items.length, 3);
  assert.ok(firstPhotoStartIndex >= 0);
  assert.ok(firstPhotoItemIndex > firstPhotoStartIndex);
  assert.ok(pngStartIndex >= 0);
  assert.ok(pngItemIndex > pngStartIndex);
  assert.ok(items.some((item) => item.source.endsWith('photo.heic') && item.output.endsWith('.jpg') && item.status === 'completed' && item.operation === 'compress'));
  assert.ok(items.some((item) => item.source.endsWith('photo.jpg') && item.operation === 'compress'));
  assert.ok(items.some((item) => item.source.endsWith('graphic.png') && item.operation === 'compress'));
  assert.ok(items.every((item) => typeof item.startedAt === 'number' && typeof item.finishedAt === 'number' && typeof item.durationMs === 'number'));
  assert.ok(fs.existsSync(path.join(outputDir, 'graphic.png')));
  assert.ok(items.filter((item) => path.basename(item.output).startsWith('photo') && item.output.endsWith('.jpg')).length >= 2);
});

test('compress_images copy policy preserves PNG originals without invoking pngquant', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-png-copy-policy-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'graphic.png'), 'fake-png', 'utf8');

  const result = spawnSync(process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python', [
    scriptPath,
    '--source-dir', sourceDir,
    '--output-dir', outputDir,
    '--quality', '80',
    '--png-command', '__missing_pngquant__',
    '--png-mode', 'copy'
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const complete = result.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  assert.equal(complete?.items?.length, 1);
  assert.equal(complete?.items?.[0].operation, 'copy');
  assert.ok(fs.existsSync(path.join(outputDir, 'graphic.png')));
});

test('compress_images reports failed PNG compression and keeps a copied fallback output', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-png-fail-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'graphic.png'), 'fake-png', 'utf8');

  const failingPngTool = process.platform === 'win32'
    ? writeFakeTool(toolsDir, 'pngquant-fail', `@echo off
echo png failure 1>&2
exit /b 1
`)
    : writeFakeTool(toolsDir, 'pngquant-fail', `#!/usr/bin/env sh
echo "png failure" >&2
exit 1
`);

  const result = spawnSync(process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python', [
    scriptPath,
    '--source-dir', sourceDir,
    '--output-dir', outputDir,
    '--quality', '80',
    '--png-command', failingPngTool
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const complete = result.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.status, 'failed');
  assert.equal(item?.operation, 'compress');
  assert.match(item?.error ?? '', /png failure|PNG compression failed/);
  assert.ok(fs.existsSync(path.join(outputDir, 'graphic.png')));
});

test('compress_images copy policy preserves JPEG and HEIC originals without invoking tools', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-copy-policy-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'photo.jpg'), 'fake-jpg', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'photo.heic'), 'fake-heic', 'utf8');

  const result = spawnSync(process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python', [
    scriptPath,
    '--source-dir', sourceDir,
    '--output-dir', outputDir,
    '--quality', '80',
    '--encoder-command', '__missing_cjpeg__',
    '--imagemagick-command', '__missing_magick__',
    '--jpeg-mode', 'copy',
    '--heic-mode', 'copy'
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const complete = result.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  assert.equal(complete?.items?.length, 2);
  assert.ok(complete?.items?.every((item) => item.status === 'completed' && item.operation === 'copy'));
  assert.ok(fs.existsSync(path.join(outputDir, 'photo.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, 'photo.heic')));
});

test('compress_images marks excluded selected-scope files as copy operations', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-script-scope-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(path.join(sourceDir, 'keep'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'skip'), { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'keep', 'photo.jpg'), 'fake-jpg', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'skip', 'excluded.jpg'), 'fake-jpg', 'utf8');

  const tools = createFakeTools(toolsDir);
  const pythonCommand = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';
  const result = spawnSync(
    pythonCommand,
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--quality',
      '80',
      '--encoder-command',
      tools.cjpeg,
      '--imagemagick-command',
      tools.magick,
      '--selection-scope-json',
      JSON.stringify({
        excludedDirectories: [path.join(sourceDir, 'skip')],
        excludedFiles: [],
        includedDirectories: [],
        includedFiles: [],
        updatedAt: 1
      })
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);

  const complete = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const items = complete?.items ?? [];

  assert.equal(items.length, 2);
  assert.ok(items.some((item) => item.source.endsWith(path.join('keep', 'photo.jpg')) && item.operation === 'compress'));
  assert.ok(items.some((item) => item.source.endsWith(path.join('skip', 'excluded.jpg')) && item.operation === 'copy'));
});

test('compress_images decodes JPEG through djpeg when cjpeg rejects JPEG input', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-djpeg-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'photo.jpg'), 'fake-jpg', 'utf8');

  const tools = createFakeMozJpegTools(toolsDir);
  const pythonCommand = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';
  const result = spawnSync(
    pythonCommand,
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--quality',
      '80',
      '--encoder-command',
      tools.cjpeg,
      '--selection-scope-json',
      ''
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);

  const complete = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.status, 'completed');
  assert.equal(item?.operation, 'compress');
  assert.ok(item?.command?.some((value) => path.basename(value).startsWith('djpeg')));
  assert.ok(fs.existsSync(path.join(outputDir, 'photo.jpg')));
  assert.equal(fs.readFileSync(path.join(outputDir, 'photo.jpg'), 'utf8'), 'fake-jpg');
  assert.ok(tools.djpeg);
});

test('compress_images skips unchanged copy-through outputs', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-script-copy-skip-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(path.join(sourceDir, 'skip'), { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  const sourceFile = path.join(sourceDir, 'skip', 'excluded.jpg');
  fs.writeFileSync(sourceFile, 'fake-jpg-copy', 'utf8');

  const tools = createFakeTools(toolsDir);
  const pythonCommand = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';
  const args = [
    scriptPath,
    '--source-dir',
    sourceDir,
    '--output-dir',
    outputDir,
    '--quality',
    '80',
    '--encoder-command',
    tools.cjpeg,
    '--imagemagick-command',
    tools.magick,
    '--selection-scope-json',
    JSON.stringify({
      excludedDirectories: [path.join(sourceDir, 'skip')],
      excludedFiles: [],
      includedDirectories: [],
      includedFiles: [],
      updatedAt: 1
    })
  ];

  const firstResult = spawnSync(pythonCommand, args, { encoding: 'utf8' });
  assert.equal(firstResult.status, 0, firstResult.stderr);

  const outputFile = path.join(outputDir, 'skip', 'excluded.jpg');
  const firstOutputMtime = fs.statSync(outputFile).mtimeMs;
  const secondResult = spawnSync(pythonCommand, args, { encoding: 'utf8' });
  assert.equal(secondResult.status, 0, secondResult.stderr);

  const complete = secondResult.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const skippedItem = complete?.items?.find((item) => item.source.endsWith(path.join('skip', 'excluded.jpg')));

  assert.equal(skippedItem?.operation, 'copy');
  assert.equal(skippedItem?.skipped, true);
  assert.equal(typeof skippedItem?.durationMs, 'number');
  assert.equal(fs.statSync(outputFile).mtimeMs, firstOutputMtime);
});

test('compress_images resets copied EXIF orientation after HEIC auto-orient', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-orientation-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  const exifArgsLog = path.join(tempRoot, 'exiftool-args.txt');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'portrait.HEIC'), 'fake-heic', 'utf8');

  const tools = createFakeTools(toolsDir);
  const pythonCommand = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';
  const result = spawnSync(
    pythonCommand,
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--quality',
      '80',
      '--encoder-command',
      tools.cjpeg,
      '--imagemagick-command',
      tools.magick,
      '--exiftool-command',
      tools.exiftool,
      '--selection-scope-json',
      ''
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        EXIFTOOL_ARGS_LOG: exifArgsLog
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(exifArgsLog, 'utf8'), /-Orientation#=1/);
});

test('compress_images uses sharp helper for JPEG files with EXIF orientation', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-jpeg-orientation-'));
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
    '--imagemagick-command', '__missing_magick__',
    '--oriented-jpeg-helper-command', sharpHelperCommand,
    '--oriented-jpeg-helper-script', sharpHelperScript
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const complete = result.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];
  const metadata = await sharp(path.join(outputDir, 'portrait.jpg')).metadata();

  assert.equal(item?.status, 'completed');
  assert.equal(item?.operation, 'compress');
  assert.ok(item?.command?.includes(sharpHelperScript));
  assert.equal(metadata.orientation, 1);
  assert.ok((metadata.height ?? 0) > (metadata.width ?? 0));
});

test('compress_images keeps mozjpeg path for JPEG files without EXIF orientation', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-images-jpeg-standard-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'photo.jpg'), 'fake-jpg', 'utf8');

  const tools = createFakeMozJpegTools(toolsDir);
  const result = spawnSync(process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python', [
    scriptPath,
    '--source-dir', sourceDir,
    '--output-dir', outputDir,
    '--quality', '80',
    '--encoder-command', tools.cjpeg,
    '--oriented-jpeg-helper-command', '__missing_helper__',
    '--oriented-jpeg-helper-script', '__missing_helper_script__'
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const complete = result.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.status, 'completed');
  assert.equal(item?.operation, 'compress');
  assert.ok(item?.command?.some((value) => path.basename(value).startsWith('djpeg')));
  assert.doesNotMatch((item?.command ?? []).join(' '), /orientedJpegCompression/);
});
