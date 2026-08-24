import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { cleanupTrackedTestTempDirectories, createTrackedTestTempDirectory } from '../../../test-utils/tempDirectory.js';

after(() => cleanupTrackedTestTempDirectories());

type ScriptItem = {
  source: string;
  output: string;
  command?: string[];
  status?: 'completed' | 'failed';
  operation: 'compress' | 'copy';
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  skipped?: boolean;
  outcome?: 'original-retained-size';
  sourceBytes?: number;
  encodedBytes?: number;
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
echo [00:00:01]    + encoder: H.264 (libx264) 1>&2
echo [00:00:01]      + preset:  fast 1>&2
echo [00:00:01]      + quality: 22.00 (RF) 1>&2
echo [00:00:01]    + decoder: hevc 8-bit (yuv420p) 1>&2
echo [00:00:01]      + container: MPEG-4 (libavformat) 1>&2
echo [00:00:02] work: average encoding speed for job is 67.500000 fps 1>&2
exit /b 0
`
    : `#!/usr/bin/env sh
if [ "$1" = "--preset-list" ]; then
  printf 'General/\\n    Fast 1080p30\\n'
  exit 0
fi
cp "$2" "$4"
{
  printf '[00:00:01]    + encoder: H.264 (libx264)\\n'
  printf '[00:00:01]      + preset:  fast\\n'
  printf '[00:00:01]      + quality: 22.00 (RF)\\n'
  printf '[00:00:01]    + decoder: hevc 8-bit (yuv420p)\\n'
  printf '[00:00:01]      + container: MPEG-4 (libavformat)\\n'
  printf '[00:00:02] work: average encoding speed for job is 67.500000 fps\\n'
} >&2
`;

  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

test('compress_videos copy policy preserves the original container without invoking HandBrake', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-copy-policy-');
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'clip.mov'), 'fake-video', 'utf8');

  const result = spawnSync(process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python', [
    scriptPath,
    '--source-dir', sourceDir,
    '--output-dir', outputDir,
    '--output-format-mode', 'mp4',
    '--encoder-command', '__missing_handbrake__',
    '--video-mode', 'copy'
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const complete = result.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  assert.equal(complete?.items?.[0]?.operation, 'copy');
  assert.ok(fs.existsSync(path.join(outputDir, 'clip.mov')));
  assert.equal(fs.existsSync(path.join(outputDir, 'clip.mp4')), false);
});

const writeQsvFallbackVideoTool = (toolsDir: string) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `handbrake-fallback${extension}`);
  const script = process.platform === 'win32'
    ? `@echo off
if "%~1"=="--preset-list" (
  echo General/
  echo     Fast 1080p30
  exit /b 0
)
set source=%~2
set output=%~4
:scan
if "%~1"=="" goto run
if "%~1"=="--enable-hw-decoding" exit /b 3
shift
goto scan
:run
copy /Y "%source%" "%output%" >nul
exit /b 0
`
    : `#!/usr/bin/env sh
if [ "$1" = "--preset-list" ]; then
  printf 'General/\\n    Fast 1080p30\\n'
  exit 0
fi
for arg in "$@"; do
  if [ "$arg" = "--enable-hw-decoding" ]; then
    exit 3
  fi
done
cp "$2" "$4"
`;

  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

const writeSizedVideoTool = (toolsDir: string, mode: 'smaller' | 'larger') => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `handbrake-${mode}${extension}`);
  const outputCommand = mode === 'smaller'
    ? process.platform === 'win32'
      ? `type nul > "%~4"`
      : `: > "$4"`
    : process.platform === 'win32'
      ? `copy /Y "%~2" "%~4" >nul
echo encoded-output-is-larger>>"%~4"`
      : `cp "$2" "$4"
printf 'encoded-output-is-larger\\n' >> "$4"`;
  const script = process.platform === 'win32'
    ? `@echo off
if "%~1"=="--preset-list" (
  echo General/
  echo     Fast 1080p30
  exit /b 0
)
${outputCommand}
exit /b 0
`
    : `#!/usr/bin/env sh
if [ "$1" = "--preset-list" ]; then
  printf 'General/\\n    Fast 1080p30\\n'
  exit 0
fi
${outputCommand}
`;

  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

test('compress_videos emits start before completed item for selected videos', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-script-');
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
    {
      encoding: 'utf8'
    }
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
  assert.equal(typeof events[startIndex].item?.startedAt, 'number');
  if (process.platform === 'win32') {
    assert.deepEqual(events[startIndex].item?.command?.slice(-2), ['--enable-hw-decoding', 'qsv']);
  } else {
    assert.notDeepEqual(events[startIndex].item?.command?.slice(-2), ['--enable-hw-decoding', 'qsv']);
  }
  assert.equal(complete?.items?.[0]?.operation, 'compress');
  assert.equal(typeof complete?.items?.[0]?.startedAt, 'number');
  assert.equal(typeof complete?.items?.[0]?.finishedAt, 'number');
  assert.equal(typeof complete?.items?.[0]?.durationMs, 'number');
  assert.equal(fs.existsSync(path.join(outputDir, '.media-organizer', 'debug', 'handbrake')), false);
  assert.ok(fs.existsSync(path.join(outputDir, 'clip.mp4')));
});

test('compress_videos keeps a compressed video when it is smaller than the source', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-smaller-');
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'clip.mp4'), 'source-video-content', 'utf8');

  const result = spawnSync(
    process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python',
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--encoder-command',
      writeSizedVideoTool(toolsDir, 'smaller')
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

  assert.equal(item?.outcome, null);
  assert.equal(item?.sourceBytes, 'source-video-content'.length);
  assert.equal(item?.encodedBytes, 0);
  assert.equal(fs.statSync(path.join(outputDir, 'clip.mp4')).size, 0);
});

test('compress_videos retains the original when compression would make an MP4 larger', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-larger-');
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  const sourceFile = path.join(sourceDir, 'clip.mp4');
  const outputFile = path.join(outputDir, 'clip.mp4');
  fs.writeFileSync(sourceFile, 'source-video-content', 'utf8');

  const result = spawnSync(
    process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python',
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--encoder-command',
      writeSizedVideoTool(toolsDir, 'larger')
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

  assert.equal(item?.operation, 'compress');
  assert.equal(item?.outcome, 'original-retained-size');
  assert.ok((item?.encodedBytes ?? 0) > (item?.sourceBytes ?? 0));
  assert.equal(fs.readFileSync(outputFile, 'utf8'), fs.readFileSync(sourceFile, 'utf8'));
  assert.equal(fs.readdirSync(outputDir).some((name) => name.includes('media-organizer-tmp')), false);
});

test('compress_videos preserves MOV extension by default', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-preserve-mov-');
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'clip.mov'), 'fake-video', 'utf8');

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
    {
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const complete = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.operation, 'compress');
  assert.ok(item?.output.endsWith('clip.mov'));
  assert.equal(item?.command?.includes('--format'), false);
  assert.ok(fs.existsSync(path.join(outputDir, 'clip.mov')));
});

test('compress_videos converts selected MOV outputs to MP4 when requested', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-mov-to-mp4-');
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'clip.mov'), 'fake-video', 'utf8');

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
      '--output-format-mode',
      'mp4',
      '--encoder-command',
      writeFakeVideoTool(toolsDir),
      '--selection-scope-json',
      ''
    ],
    {
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const complete = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.operation, 'compress');
  assert.ok(item?.output.endsWith('clip.mp4'));
  assert.ok(item?.command?.includes('--format'));
  assert.ok(item?.command?.includes('av_mp4'));
  assert.ok(fs.existsSync(path.join(outputDir, 'clip.mp4')));
  assert.equal(fs.existsSync(path.join(outputDir, 'clip.mov')), false);
});

test('compress_videos keeps an explicitly requested MOV to MP4 conversion even when it is larger', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-larger-mp4-conversion-');
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'clip.mov'), 'source-video-content', 'utf8');

  const result = spawnSync(
    process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python',
    [
      scriptPath,
      '--source-dir',
      sourceDir,
      '--output-dir',
      outputDir,
      '--output-format-mode',
      'mp4',
      '--encoder-command',
      writeSizedVideoTool(toolsDir, 'larger')
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

  assert.equal(item?.outcome, null);
  assert.ok((item?.encodedBytes ?? 0) > (item?.sourceBytes ?? 0));
  assert.ok(fs.statSync(path.join(outputDir, 'clip.mp4')).size > fs.statSync(path.join(sourceDir, 'clip.mov')).size);
});

test('compress_videos keeps excluded MOV copies in their original container', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-copy-mov-');
  const sourceDir = path.join(tempRoot, 'source');
  const outputDir = path.join(tempRoot, 'output');
  const toolsDir = path.join(tempRoot, 'tools');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  const sourceFile = path.join(sourceDir, 'clip.mov');
  fs.writeFileSync(sourceFile, 'fake-video', 'utf8');

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
      '--output-format-mode',
      'mp4',
      '--encoder-command',
      writeFakeVideoTool(toolsDir),
      '--selection-scope-json',
      JSON.stringify({
        excludedDirectories: [],
        excludedFiles: [sourceFile],
        includedDirectories: [],
        includedFiles: [],
        updatedAt: 1
      })
    ],
    {
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const complete = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.operation, 'copy');
  assert.ok(item?.output.endsWith('clip.mov'));
  assert.equal(item?.command?.includes('--format'), false);
  assert.ok(fs.existsSync(path.join(outputDir, 'clip.mov')));
  assert.equal(fs.existsSync(path.join(outputDir, 'clip.mp4')), false);
});

test('compress_videos does not create HandBrake debug logs', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-no-debug-');
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
    {
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const complete = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.operation, 'compress');
  assert.equal(fs.existsSync(path.join(outputDir, '.media-organizer', 'debug', 'handbrake')), false);
});

test('compress_videos retries without QSV hardware decoding when it fails', () => {
  const tempRoot = createTrackedTestTempDirectory('media-organizer-videos-fallback-');
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
      writeQsvFallbackVideoTool(toolsDir),
      '--selection-scope-json',
      ''
    ],
    {
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0, result.stderr);

  const complete = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; items?: ScriptItem[] })
    .find((event) => event.type === 'complete');
  const item = complete?.items?.[0];

  assert.equal(item?.status, 'completed');
  assert.ok(fs.existsSync(path.join(outputDir, 'clip.mp4')));
});
