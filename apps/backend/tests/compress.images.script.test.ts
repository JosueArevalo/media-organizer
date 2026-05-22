import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

type ScriptItem = {
  source: string;
  output: string;
  status: 'completed' | 'failed';
  warning?: string | null;
};

const repoRoot = path.resolve(process.cwd(), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'media_tools', 'compress_images.py');

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

  return { magick, cjpeg };
};

test('compress_images converts selected HEIC to JPG and copies PNG without compression', () => {
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

  assert.equal(items.length, 3);
  assert.ok(items.some((item) => item.source.endsWith('photo.heic') && item.output.endsWith('.jpg') && item.status === 'completed'));
  assert.ok(items.some((item) => item.source.endsWith('graphic.png') && item.warning?.includes('copied without compression')));
  assert.ok(fs.existsSync(path.join(outputDir, 'graphic.png')));
  assert.ok(items.filter((item) => path.basename(item.output).startsWith('photo') && item.output.endsWith('.jpg')).length >= 2);
});
