import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

type ScriptItem = {
  source: string;
  output: string;
  status?: 'completed' | 'failed';
  operation: 'compress' | 'copy';
};

const repoRoot = path.resolve(process.cwd(), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'media_tools', 'compress_videos.py');

const writeFakeVideoTool = (toolsDir: string) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `handbrake-fake${extension}`);
  const script = process.platform === 'win32'
    ? `@echo off
if "%~1"=="--preset-list" (
  echo General/
  echo     Fast 1080p30
  exit /b 0
)
copy /Y "%~2" "%~4" >nul
exit /b 0
`
    : `#!/usr/bin/env sh
if [ "$1" = "--preset-list" ]; then
  printf 'General/\\n    Fast 1080p30\\n'
  exit 0
fi
cp "$2" "$4"
`;

  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

test('compress_videos emits start before completed item for selected videos', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-videos-script-'));
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'clip.mp4'), 'fake-video', 'utf8');

  const pythonCommand = process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';
  const result = spawnSync(
    pythonCommand,
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--preset',
      'Fast 1080p30',
      '--encoder-command',
      writeFakeVideoTool(toolsDir),
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
  const startIndex = events.findIndex((event) => event.type === 'start' && event.item?.source.endsWith('clip.mp4'));
  const itemIndex = events.findIndex((event) => event.type === 'item' && event.item?.source.endsWith('clip.mp4'));
  const complete = events.find((event) => event.type === 'complete');

  assert.ok(startIndex >= 0);
  assert.ok(itemIndex > startIndex);
  assert.equal(events[startIndex].item?.operation, 'compress');
  assert.equal(complete?.items?.[0]?.operation, 'compress');
  assert.ok(fs.existsSync(path.join(outputDir, 'clip.mp4')));
});
