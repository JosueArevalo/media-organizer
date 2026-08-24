import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';
import { cleanupTrackedTestTempDirectories, createTrackedTestTempDirectory } from '../../../test-utils/tempDirectory.js';

const tempRoot = createTrackedTestTempDirectory('media-organizer-compression-test-');
after(() => {
  resetDbForTests();
  cleanupTrackedTestTempDirectories();
});
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');
const sourceDir = path.join(tempRoot, 'source');
const outputDir = path.join(tempRoot, 'output');

const sleep = async (milliseconds: number) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const writeFakeVideoTool = (toolsDir: string, delayMilliseconds: number) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `handbrake-slow${extension}`);
  const delaySeconds = Math.max(1, Math.ceil(delayMilliseconds / 1000));
  const script = process.platform === 'win32'
    ? `@echo off
if "%~1"=="--preset-list" (
  echo General/
  echo     Fast 1080p30
  exit /b 0
)
powershell.exe -NoProfile -Command "Start-Sleep -Milliseconds ${delayMilliseconds}"
copy /Y "%~2" "%~4" >nul
exit /b 0
`
    : `#!/usr/bin/env sh
if [ "$1" = "--preset-list" ]; then
  printf 'General/\\n    Fast 1080p30\\n'
  exit 0
fi
sleep ${delaySeconds}
cp "$2" "$4"
`;

  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

const writeFakeImageTool = (toolsDir: string, callLogPath: string) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `cjpeg-fake${extension}`);
  const script = process.platform === 'win32'
    ? `@echo off
set OUT=
set IN=
set NEXT_OUT=
:loop
if "%~1"=="" goto done
if "%~1"=="-outfile" goto markout
if "%NEXT_OUT%"=="1" goto setout
set IN=%~1
shift
goto loop
:markout
set NEXT_OUT=1
shift
goto loop
:setout
set OUT=%~1
set NEXT_OUT=
shift
goto loop
:done
echo %IN%>>"${callLogPath}"
copy /Y "%IN%" "%OUT%" >nul
exit /b 0
`
    : `#!/usr/bin/env sh
out=""
input=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-outfile" ]; then
    shift
    out="$1"
  else
    input="$1"
  fi
  shift
done
printf '%s\\n' "$input" >> "${callLogPath}"
cp "$input" "$out"
`;

  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

const writeSlowFakeImageTool = (toolsDir: string, callLogPath: string, delayMilliseconds: number) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `cjpeg-slow${extension}`);
  const delaySeconds = Math.max(1, Math.ceil(delayMilliseconds / 1000));
  const script = process.platform === 'win32'
    ? `@echo off
set OUT=
set IN=
set NEXT_OUT=
:loop
if "%~1"=="" goto done
if "%~1"=="-outfile" goto markout
if "%NEXT_OUT%"=="1" goto setout
set IN=%~1
shift
goto loop
:markout
set NEXT_OUT=1
shift
goto loop
:setout
set OUT=%~1
set NEXT_OUT=
shift
goto loop
:done
echo %IN%>>"${callLogPath}"
powershell.exe -NoProfile -Command "Start-Sleep -Milliseconds ${delayMilliseconds}"
copy /Y "%IN%" "%OUT%" >nul
exit /b 0
`
    : `#!/usr/bin/env sh
out=""
input=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-outfile" ]; then
    shift
    out="$1"
  else
    input="$1"
  fi
  shift
done
printf '%s\\n' "$input" >> "${callLogPath}"
sleep ${delaySeconds}
cp "$input" "$out"
`;

  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  resetDbForTests();
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  resetDbForTests();
});

test('startCompressionSession creates a resumable session and output scaffold', async () => {
  const { startCompressionSession, getCompressionSession } = await import('../src/pipeline/compression/compressionJob.service.js');

  const result = startCompressionSession({
    name: 'Test compression session',
    sourceDir,
    outputDir,
    imageQuality: 82,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced'
  });

  assert.equal(result.session.status, 'running');
  assert.match(result.outputRoot, new RegExp(`^${outputDir.replace(/\\/g, '\\\\')}`));
  assert.ok(fs.existsSync(result.outputRoot));
  assert.ok(fs.existsSync(result.manifestPath));

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as {
    imageToolCommand: string;
    pngToolCommand: string;
    videoToolCommand: string;
    videoOutputFormatMode: string;
    imageMagickCommand: string;
    exifToolCommand: string;
  };
  assert.equal(manifest.imageToolCommand, 'cjpeg');
  assert.equal(manifest.pngToolCommand, 'pngquant');
  assert.equal(manifest.videoToolCommand, 'HandBrakeCLI');
  assert.equal(manifest.videoOutputFormatMode, 'preserve');
  assert.ok(['magick', 'magick.exe'].includes(path.basename(manifest.imageMagickCommand).toLowerCase()));
  assert.equal(manifest.exifToolCommand, '');

  const persisted = getCompressionSession(result.session.id);
  assert.ok(persisted);
  assert.equal(persisted?.session.status, 'running');
  assert.equal(persisted?.checkpoint?.stage, 'compress');

  const db = getDb();
  const sessionRows = db.prepare('SELECT id, status, source_dir, output_dir FROM sessions WHERE id = ?').all(result.session.id) as Array<{
    id: string;
    status: string;
    source_dir: string;
    output_dir: string;
  }>;

  assert.equal(sessionRows.length, 1);
  assert.equal(sessionRows[0].status, 'running');
  assert.equal(sessionRows[0].source_dir, sourceDir);
  assert.equal(sessionRows[0].output_dir, outputDir);

  const checkpointRows = db.prepare('SELECT stage, payload_json FROM session_checkpoints WHERE session_id = ?').all(result.session.id) as Array<{
    stage: string;
    payload_json: string | null;
  }>;

  assert.equal(checkpointRows.length, 1);
  assert.equal(checkpointRows[0].stage, 'compress');
  assert.ok(checkpointRows[0].payload_json?.includes('outputRoot'));

  const checkpointPayload = JSON.parse(checkpointRows[0].payload_json ?? '{}') as {
    timing?: { segments?: Array<{ startedAt: string; endedAt?: string }> };
  };
  assert.equal(checkpointPayload.timing?.segments?.length, 1);
  assert.equal(checkpointPayload.timing?.segments?.[0].startedAt, result.session.createdAt);
  assert.equal(checkpointPayload.timing?.segments?.[0].endedAt, undefined);

  const historyRow = db.prepare(
    'SELECT compression_active_duration_ms, compression_active_started_at FROM execution_history WHERE session_id = ?'
  ).get(result.session.id) as { compression_active_duration_ms: number | null; compression_active_started_at: string | null };
  assert.equal(historyRow.compression_active_duration_ms, 0);
  assert.equal(historyRow.compression_active_started_at, result.session.createdAt);
});

test('compression resume commands use skip files instead of inline JSON arguments', async () => {
  const { buildImageCompressionCommand } = await import('../src/pipeline/compression/compressionCommandBuilder.js?resume-skip-file=1');
  const scopedOutputDir = path.join(tempRoot, 'resume-skip-file-output');
  fs.rmSync(scopedOutputDir, { recursive: true, force: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });

  const resumeItems = Array.from({ length: 50 }, (_, index) => ({
    source: path.join(tempRoot, 'source', 'very', 'long', 'nested', 'folder', `${index}`, 'photo-with-a-long-name.jpg'),
    output: path.join(scopedOutputDir, 'very', 'long', 'nested', 'folder', `${index}`, 'photo-with-a-long-name.jpg')
  }));

  const command = buildImageCompressionCommand({
    sessionId: 'resume-skip-file-session',
    sourceDir,
    outputDir: scopedOutputDir,
    outputRoot: scopedOutputDir,
    imageOutputDir: scopedOutputDir,
    videoOutputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    videoOutputFormatMode: 'preserve',
    imageToolCommand: 'cjpeg',
    pngToolCommand: 'pngquant',
    videoToolCommand: 'HandBrakeCLI',
    imageMagickCommand: 'magick',
    exifToolCommand: '',
    processingPolicy: { jpeg: 'compress', png: 'compress', heic: 'convert', video: 'compress' },
    selectionScope: {
      excludedDirectories: [],
      excludedFiles: [],
      includedDirectories: [],
      includedFiles: [],
      updatedAt: 0
    }
  }, resumeItems);

  assert.equal(command.args.includes('--resume-skip-json'), false);
  const skipFileFlagIndex = command.args.indexOf('--resume-skip-file');
  assert.notEqual(skipFileFlagIndex, -1);
  const skipFilePath = command.args[skipFileFlagIndex + 1];
  assert.equal(skipFilePath, path.join(scopedOutputDir, '.media-organizer', 'resume-skip-images.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(skipFilePath, 'utf8')), resumeItems);
});

test('compression services ignore active grouping sessions', async () => {
  const {
    getActiveCompressionSession,
    getCompressionProgress,
    getCompressionSession,
    markCompressionSessionFailed,
    reconcileInterruptedCompressionSessions,
    startCompressionSession,
    startCompressionSessionResume
  } = await import('../src/pipeline/compression/compressionJob.service.js?ignore-grouping-sessions=1');
  const { startGroupingSession } = await import('../src/pipeline/grouping/groupingJob.service.js?ignore-grouping-sessions=1');
  const compression = startCompressionSession({
    name: 'Completed compression before grouping',
    sourceDir,
    outputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30'
  });
  const db = getDb();
  db.prepare(
    `
      UPDATE sessions
      SET status = 'completed'
      WHERE id IN (
        SELECT session_id FROM session_checkpoints WHERE stage = 'compress'
      )
    `
  ).run();

  const grouping = startGroupingSession({
    name: 'Active grouping after compression',
    sourceDir,
    outputDir,
    compressionSessionId: compression.session.id
  });

  assert.equal(getActiveCompressionSession(), null);
  assert.equal(getCompressionSession(grouping.session.id), null);
  assert.equal(getCompressionProgress(grouping.session.id), null);
  assert.equal(startCompressionSessionResume(grouping.session.id), null);
  assert.equal(markCompressionSessionFailed(grouping.session.id, new Error('Must not affect grouping')), null);
  assert.equal(reconcileInterruptedCompressionSessions(), 0);

  const groupingRow = db.prepare('SELECT status FROM sessions WHERE id = ?').get(grouping.session.id) as { status: string };
  assert.equal(groupingRow.status, 'running');
});

test('executeCompressionSession persists per-item compression statuses', async () => {
  const { startCompressionSession, getCompressionSession } = await import('../src/pipeline/compression/compressionJob.service.js');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js');

  fs.mkdirSync(path.join(sourceDir, 'album'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'album', 'photo.jpg'), 'fake-jpg-content', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'album', 'clip.mp4'), 'fake-video-content', 'utf8');

  const started = startCompressionSession({
    name: 'Execution test session',
    sourceDir,
    outputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: '__missing_video_encoder__'
  });

  await executeCompressionSession(started.session.id);

  const persisted = getCompressionSession(started.session.id);
  assert.ok(persisted);
  assert.equal(persisted?.session.status, 'failed');

  const db = getDb();
  const itemRows = db.prepare('SELECT source_path FROM media_items WHERE session_id = ? ORDER BY source_path').all(started.session.id) as Array<{
    source_path: string;
  }>;
  assert.equal(itemRows.length, 2);

  const statusRows = db
    .prepare(
      `
        SELECT iss.status, mi.source_path
        FROM item_stage_status iss
        JOIN media_items mi ON mi.id = iss.item_id
        WHERE iss.session_id = ? AND iss.stage = 'compress'
        ORDER BY mi.source_path
      `
    )
    .all(started.session.id) as Array<{ status: string; source_path: string }>;

  assert.equal(statusRows.length, 2);
  assert.deepEqual(statusRows.map((row) => row.status), ['failed', 'failed']);

  const outputImage = path.join(started.outputRoot, 'album', 'photo.jpg');
  const outputVideo = path.join(started.outputRoot, 'album', 'clip.mp4');

  assert.ok(fs.existsSync(outputImage));
  assert.ok(fs.existsSync(outputVideo));
});

test('executeCompressionSession counts copied excluded media in progress while preserving compression decisions', async () => {
  const { startCompressionSession, getCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js');
  const scopedSourceDir = path.join(tempRoot, 'scope-progress-source');
  const scopedOutputDir = path.join(tempRoot, 'scope-progress-output');

  fs.mkdirSync(path.join(scopedSourceDir, 'include'), { recursive: true });
  fs.mkdirSync(path.join(scopedSourceDir, 'exclude'), { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.writeFileSync(path.join(scopedSourceDir, 'include', 'selected.jpg'), 'fake-jpg-content', 'utf8');
  fs.writeFileSync(path.join(scopedSourceDir, 'exclude', 'copied.jpg'), 'fake-jpg-content', 'utf8');
  fs.writeFileSync(path.join(scopedSourceDir, 'exclude', 'notes.txt'), 'not-media', 'utf8');

  const started = startCompressionSession({
    name: 'Scope progress test session',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: '__missing_video_encoder__',
    selectionScope: {
      excludedDirectories: [path.join(scopedSourceDir, 'exclude')],
      excludedFiles: [],
      includedDirectories: [],
      includedFiles: [],
      updatedAt: 1
    }
  });

  const result = await executeCompressionSession(started.session.id);

  assert.equal(result.totalCount, 2);
  assert.equal(result.completedCount, 1);
  assert.equal(result.failedCount, 1);

  const { listExecutionHistory } = await import('../src/dashboard/dashboard.service.js?compression-size-metrics=1');
  const execution = listExecutionHistory().find((item) => item.sessionId === started.session.id);
  const copiedSourceSize = fs.statSync(path.join(scopedSourceDir, 'exclude', 'copied.jpg')).size;
  const copiedOutputSize = fs.statSync(path.join(started.outputRoot, 'exclude', 'copied.jpg')).size;
  assert.equal(execution?.originalBytes, copiedSourceSize);
  assert.equal(execution?.finalBytes, copiedOutputSize);
  assert.equal(execution?.imageQuality, 80);

  const progress = getCompressionProgress(started.session.id);
  assert.ok(progress);
  assert.equal(progress?.total, 2);
  assert.equal(progress?.completed, 1);
  assert.equal(progress?.failed, 1);
  assert.equal(progress?.totalCompress, 1);
  assert.equal(progress?.totalCopy, 1);
  assert.equal(progress?.completedCompress, 0);
  assert.equal(progress?.completedCopy, 1);
  assert.equal(progress?.failedCompress, 1);
  assert.equal(progress?.failedCopy, 0);

  const persisted = getCompressionSession(started.session.id);
  assert.equal(persisted?.session.status, 'failed');

  const db = getDb();
  const decisionRows = db
    .prepare(
      `
        SELECT mi.source_path, idc.selected_for_compression
        FROM item_decisions idc
        JOIN media_items mi ON mi.id = idc.item_id
        WHERE idc.session_id = ?
        ORDER BY mi.source_path
      `
    )
    .all(started.session.id) as Array<{ source_path: string; selected_for_compression: number }>;

  assert.equal(decisionRows.length, 2);
  assert.equal(decisionRows.find((row) => row.source_path.endsWith(path.join('include', 'selected.jpg')))?.selected_for_compression, 1);
  assert.equal(decisionRows.find((row) => row.source_path.endsWith(path.join('exclude', 'copied.jpg')))?.selected_for_compression, 0);
  assert.ok(fs.existsSync(path.join(started.outputRoot, 'exclude', 'copied.jpg')));
});

test('executeCompressionSession completes copy-only sessions when all media is excluded from compression', async () => {
  const { startCompressionSession, getCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js');
  const scopedSourceDir = path.join(tempRoot, 'copy-only-source');
  const scopedOutputDir = path.join(tempRoot, 'copy-only-output');

  fs.mkdirSync(path.join(scopedSourceDir, 'album'), { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.writeFileSync(path.join(scopedSourceDir, 'album', 'photo.jpg'), 'fake-jpg-content', 'utf8');
  fs.writeFileSync(path.join(scopedSourceDir, 'album', 'clip.mp4'), 'fake-video-content', 'utf8');

  const started = startCompressionSession({
    name: 'Copy-only compression session',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: '__missing_video_encoder__',
    selectionScope: {
      excludedDirectories: [scopedSourceDir],
      excludedFiles: [],
      includedDirectories: [],
      includedFiles: [],
      updatedAt: 1
    }
  });

  const result = await executeCompressionSession(started.session.id);

  assert.equal(result.totalCount, 2);
  assert.equal(result.completedCount, 2);
  assert.equal(result.failedCount, 0);

  const progress = getCompressionProgress(started.session.id);
  assert.ok(progress);
  assert.equal(progress.total, 2);
  assert.equal(progress.totalCompress, 0);
  assert.equal(progress.totalCopy, 2);
  assert.equal(progress.completedCompress, 0);
  assert.equal(progress.completedCopy, 2);
  assert.equal(progress.failedCompress, 0);
  assert.equal(progress.failedCopy, 0);

  const persisted = getCompressionSession(started.session.id);
  assert.equal(persisted?.session.status, 'completed');
  assert.ok(fs.existsSync(path.join(started.outputRoot, 'album', 'photo.jpg')));
  assert.ok(fs.existsSync(path.join(started.outputRoot, 'album', 'clip.mp4')));

  const decisionRows = getDb()
    .prepare(
      `
        SELECT idc.selected_for_compression
        FROM item_decisions idc
        WHERE idc.session_id = ?
        ORDER BY idc.item_id
      `
    )
    .all(started.session.id) as Array<{ selected_for_compression: number }>;

  assert.equal(decisionRows.length, 2);
  assert.deepEqual(decisionRows.map((row) => row.selected_for_compression), [0, 0]);
});

test('explicit copy processing policy persists copy operations and progress counts', async () => {
  const { startCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js');
  const scopedSourceDir = path.join(tempRoot, 'policy-copy-source');
  const scopedOutputDir = path.join(tempRoot, 'policy-copy-output');
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.writeFileSync(path.join(scopedSourceDir, 'photo.jpg'), 'fake-jpg', 'utf8');
  fs.writeFileSync(path.join(scopedSourceDir, 'clip.mov'), 'fake-video', 'utf8');

  const started = startCompressionSession({
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    processingPolicy: { jpeg: 'copy', png: 'copy', heic: 'copy', video: 'copy' }
  });
  await executeCompressionSession(started.session.id);

  const progress = getCompressionProgress(started.session.id);
  assert.equal(progress?.status, 'completed');
  assert.equal(progress?.total, 2);
  assert.equal(progress?.totalCompress, 0);
  assert.equal(progress?.totalCopy, 2);
  assert.equal(progress?.completedCopy, 2);
  assert.ok(progress?.processedItems.every((item) => item.operation === 'copy'));
});

test('executeCompressionSession preserves accented file names in persisted state and progress payloads', async () => {
  const { startCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js');
  const scopedSourceDir = path.join(tempRoot, 'accented-source');
  const scopedOutputDir = path.join(tempRoot, 'accented-output');
  const imageName = '20251129_203031_pruebíta.jpg';
  const videoName = '20251129_184550_pruebéta.mp4';

  fs.rmSync(scopedSourceDir, { recursive: true, force: true });
  fs.rmSync(scopedOutputDir, { recursive: true, force: true });
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.writeFileSync(path.join(scopedSourceDir, imageName), 'fake-jpg', 'utf8');
  fs.writeFileSync(path.join(scopedSourceDir, videoName), 'fake-video', 'utf8');

  const started = startCompressionSession({
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    processingPolicy: { jpeg: 'copy', png: 'copy', heic: 'copy', video: 'copy' }
  });

  await executeCompressionSession(started.session.id);

  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT source_path, relative_path
        FROM media_items
        WHERE session_id = ?
        ORDER BY relative_path ASC
      `
    )
    .all(started.session.id) as Array<{ source_path: string; relative_path: string }>;

  assert.deepEqual(
    rows
      .map((row) => ({
        sourcePath: path.basename(row.source_path),
        relativePath: row.relative_path
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' })),
    [
      { sourcePath: videoName, relativePath: videoName },
      { sourcePath: imageName, relativePath: imageName }
    ].sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' }))
  );

  const progress = getCompressionProgress(started.session.id);
  assert.equal(progress?.status, 'completed');
  assert.deepEqual(
    progress?.processedItems
      .map((item) => ({
        sourcePath: path.basename(item.sourcePath),
        displayPath: item.displayPath
      }))
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, undefined, { sensitivity: 'base' })),
    [
      { sourcePath: imageName, displayPath: imageName },
      { sourcePath: videoName, displayPath: videoName }
    ].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, undefined, { sensitivity: 'base' }))
  );
  assert.equal(progress?.processedItems.some((item) => item.sourcePath.includes('�') || (item.displayPath?.includes('�') ?? false)), false);
});

test('compression progress reports the actively processing video and clears it after completion', async () => {
  const { startCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js');
  const scopedSourceDir = path.join(tempRoot, 'active-video-source');
  const scopedOutputDir = path.join(tempRoot, 'active-video-output');
  const toolsDir = path.join(tempRoot, 'active-video-tools');
  const sourceSubdir = path.join(scopedSourceDir, 'album', 'clips');
  const expectedDisplayPath = ['album', 'clips', 'slow.mp4'].join('\\');
  fs.mkdirSync(sourceSubdir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceSubdir, 'slow.mp4'), 'fake-video-content', 'utf8');

  const started = startCompressionSession({
    name: 'Active video progress test',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: writeFakeVideoTool(toolsDir, 1000)
  });

  const execution = executeCompressionSession(started.session.id);
  let activeProgress = getCompressionProgress(started.session.id);

  for (let attempt = 0; attempt < 100 && !activeProgress?.currentlyProcessing.length; attempt += 1) {
    await sleep(100);
    activeProgress = getCompressionProgress(started.session.id);
  }

  assert.equal(activeProgress?.currentlyProcessing.length, 1);
  assert.equal(activeProgress?.currentlyProcessing[0].operation, 'compress');
  assert.ok(activeProgress?.currentlyProcessing[0].sourcePath.endsWith('slow.mp4'));
  assert.equal(activeProgress?.currentlyProcessing[0].displayPath, expectedDisplayPath);
  assert.equal(typeof activeProgress?.currentlyProcessing[0].startedAt, 'number');

  await execution;

  const finalProgress = getCompressionProgress(started.session.id);
  assert.ok(finalProgress);
  assert.equal(finalProgress?.status, 'completed');
  assert.equal(finalProgress?.currentlyProcessing.length, 0);
  assert.equal(finalProgress?.processedItems.length, 1);
  assert.equal(finalProgress?.processedItems[0].operation, 'compress');
  assert.equal(finalProgress?.processedItems[0].displayPath, expectedDisplayPath);
  assert.equal(finalProgress?.processedItems[0].outcome, 'original-retained-size');
  assert.equal(finalProgress?.completedCompress, 0);
  assert.equal(finalProgress?.completedCopy, 0);
  assert.equal(finalProgress?.retainedOriginalBecauseLarger, 1);
  assert.equal(typeof finalProgress?.processedItems[0].durationMs, 'number');

  await executeCompressionSession(started.session.id);
  const resumedProgress = getCompressionProgress(started.session.id);
  assert.equal(resumedProgress?.retainedOriginalBecauseLarger, 1);
  assert.equal(resumedProgress?.processedItems[0].outcome, 'original-retained-size');
});

test('compression progress normalizes Windows path aliases for active and processed items', async () => {
  const originalRealpathNative = fs.realpathSync.native;
  const aliasSegment = process.platform === 'win32' ? 'RUNNER~1' : 'runner-alias';

  fs.realpathSync.native = ((targetPath: fs.PathLike) => {
    const resolved = originalRealpathNative(targetPath);
    return typeof resolved === 'string' ? resolved.replace('runneradmin', aliasSegment) : resolved;
  }) as typeof fs.realpathSync.native;

  try {
    const { startCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js?path-alias=1');
    const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js?path-alias=1');
    const scopedSourceDir = path.join(tempRoot, 'path-alias-source');
    const scopedOutputDir = path.join(tempRoot, 'path-alias-output');
    const toolsDir = path.join(tempRoot, 'path-alias-tools');
    const sourceSubdir = path.join(scopedSourceDir, 'album', 'clips');
    const expectedDisplayPath = ['album', 'clips', 'slow.mp4'].join('\\');
    fs.mkdirSync(sourceSubdir, { recursive: true });
    fs.mkdirSync(scopedOutputDir, { recursive: true });
    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(path.join(sourceSubdir, 'slow.mp4'), 'fake-video-content', 'utf8');

    const started = startCompressionSession({
      name: 'Path alias progress test',
      sourceDir: scopedSourceDir,
      outputDir: scopedOutputDir,
      imageQuality: 80,
      imageProfileLabel: 'Balanced',
      videoPresetLabel: 'Fast 1080p30',
      imageToolCommand: '__missing_image_encoder__',
      videoToolCommand: writeFakeVideoTool(toolsDir, 1000)
    });

    const execution = executeCompressionSession(started.session.id);
    let activeProgress = getCompressionProgress(started.session.id);

    for (let attempt = 0; attempt < 100 && !activeProgress?.currentlyProcessing.length; attempt += 1) {
      await sleep(100);
      activeProgress = getCompressionProgress(started.session.id);
    }

    assert.equal(activeProgress?.currentlyProcessing[0].displayPath, expectedDisplayPath);

    await execution;

    const finalProgress = getCompressionProgress(started.session.id);
    assert.equal(finalProgress?.processedItems[0].displayPath, expectedDisplayPath);
  } finally {
    fs.realpathSync.native = originalRealpathNative;
  }
});

test('pauseCompressionSession stops active compression and resume processes pending items', async () => {
  const {
    getCompressionProgress,
    getCompressionSession,
    markCompressionSessionRunning,
    pauseCompressionSession,
    startCompressionSession
  } = await import('../src/pipeline/compression/compressionJob.service.js?pause-runner=1');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js?pause-runner=1');
  const scopedSourceDir = path.join(tempRoot, 'pause-runner-source');
  const scopedOutputDir = path.join(tempRoot, 'pause-runner-output');
  const toolsDir = path.join(tempRoot, 'pause-runner-tools');
  const callLogPath = path.join(tempRoot, 'pause-runner-calls.log');
  fs.rmSync(scopedSourceDir, { recursive: true, force: true });
  fs.rmSync(scopedOutputDir, { recursive: true, force: true });
  fs.rmSync(toolsDir, { recursive: true, force: true });
  fs.rmSync(callLogPath, { force: true });
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  for (const name of ['one.jpg', 'two.jpg']) {
    fs.writeFileSync(path.join(scopedSourceDir, name), `source-${name}`, 'utf8');
  }

  const started = startCompressionSession({
    name: 'Pause compression test',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    imageToolCommand: writeSlowFakeImageTool(toolsDir, callLogPath, 4000),
    videoToolCommand: '__missing_video_encoder__'
  });

  const firstRun = executeCompressionSession(started.session.id);
  let activeProgress = getCompressionProgress(started.session.id);

  for (let attempt = 0; attempt < 100 && !activeProgress?.currentlyProcessing.length; attempt += 1) {
    await sleep(50);
    activeProgress = getCompressionProgress(started.session.id);
  }

  assert.equal(activeProgress?.currentlyProcessing.length, 1);
  const paused = pauseCompressionSession(started.session.id);
  assert.equal(paused?.session.status, 'paused');
  assert.equal(paused?.progress?.currentlyProcessing.length, 0);

  await firstRun;

  const pausedProgress = getCompressionProgress(started.session.id);
  assert.equal(getCompressionSession(started.session.id)?.session.status, 'paused');
  assert.equal(pausedProgress?.currentlyProcessing.length, 0);
  assert.equal(pausedProgress?.failed, 0);
  const db = getDb();
  const pausedHistory = db.prepare(
    'SELECT status, compression_active_duration_ms, compression_active_started_at FROM execution_history WHERE session_id = ?'
  ).get(started.session.id) as { status: string; compression_active_duration_ms: number | null; compression_active_started_at: string | null };
  assert.equal(pausedHistory.status, 'paused');
  assert.equal(pausedHistory.compression_active_started_at, null);
  assert.equal(typeof pausedHistory.compression_active_duration_ms, 'number');
  assert.ok((pausedHistory.compression_active_duration_ms ?? 0) > 0);

  const pausedCheckpoint = db.prepare(
    'SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?'
  ).get(started.session.id, 'compress') as { payload_json: string | null };
  const pausedPayload = JSON.parse(pausedCheckpoint.payload_json ?? '{}') as {
    timing?: { segments?: Array<{ endedAt?: string; reason?: string }> };
  };
  assert.equal(pausedPayload.timing?.segments?.at(-1)?.reason, 'pause');
  assert.equal(typeof pausedPayload.timing?.segments?.at(-1)?.endedAt, 'string');

  markCompressionSessionRunning(started.session.id);
  const resumedHistory = db.prepare(
    'SELECT status, compression_active_duration_ms, compression_active_started_at FROM execution_history WHERE session_id = ?'
  ).get(started.session.id) as { status: string; compression_active_duration_ms: number | null; compression_active_started_at: string | null };
  assert.equal(resumedHistory.status, 'running');
  assert.equal(resumedHistory.compression_active_duration_ms, pausedHistory.compression_active_duration_ms);
  assert.equal(typeof resumedHistory.compression_active_started_at, 'string');
  await executeCompressionSession(started.session.id);

  const finalProgress = getCompressionProgress(started.session.id);
  assert.equal(finalProgress?.status, 'completed');
  assert.equal(finalProgress?.completed, 2);
  assert.equal(finalProgress?.failed, 0);
  const completedHistory = db.prepare(
    'SELECT compression_active_duration_ms, compression_active_started_at FROM execution_history WHERE session_id = ?'
  ).get(started.session.id) as { compression_active_duration_ms: number | null; compression_active_started_at: string | null };
  assert.equal(completedHistory.compression_active_started_at, null);
  assert.ok((completedHistory.compression_active_duration_ms ?? 0) >= (pausedHistory.compression_active_duration_ms ?? 0));
});

test('compression progress falls back to absolute display paths outside the source directory', async () => {
  const { startCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js?display-path-fallback=1');
  const scopedSourceDir = path.join(tempRoot, 'display-path-source');
  const scopedOutputDir = path.join(tempRoot, 'display-path-output');
  const outsideSourcePath = path.join(tempRoot, 'outside-source.jpg');
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.writeFileSync(outsideSourcePath, 'outside-source-content', 'utf8');

  const started = startCompressionSession({
    name: 'Display path fallback test',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: '__missing_video_encoder__'
  });

  getDb().prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?
      WHERE session_id = ? AND stage = 'compress'
    `
  ).run(
    JSON.stringify({
      outputRoot: started.outputRoot,
      manifest: started.manifest,
      totalCount: 1,
      summary: {
        completedItems: 0,
        failedItems: 1,
        totalCompressCount: 1,
        totalCopyCount: 0,
        completedCompressCount: 0,
        completedCopyCount: 0,
        failedCompressCount: 1,
        failedCopyCount: 0
      },
      activeItems: [{
        id: outsideSourcePath,
        sourcePath: outsideSourcePath,
        operation: 'compress',
        startedAt: Date.now()
      }],
      processedItems: [{
        source: outsideSourcePath,
        output: path.join(scopedOutputDir, 'outside-source.jpg'),
        command: [],
        status: 'failed',
        error: 'Fake encoder could not read the image.',
        operation: 'compress'
      }]
    }),
    started.session.id
  );

  const progress = getCompressionProgress(started.session.id);
  assert.equal(progress?.currentlyProcessing[0].displayPath, outsideSourcePath);
  assert.equal(progress?.processedItems[0].displayPath, outsideSourcePath);
  assert.equal(progress?.processedItems[0].error, 'Fake encoder could not read the image.');
});

test('failed compression sessions resume only failed image items', async () => {
  const { startCompressionSession, startCompressionSessionResume, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js?resume-failed-only=1');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js?resume-failed-only=1');
  const scopedSourceDir = path.join(tempRoot, 'resume-failed-source');
  const scopedOutputDir = path.join(tempRoot, 'resume-failed-output');
  const toolsDir = path.join(tempRoot, 'resume-failed-tools');
  const callLogPath = path.join(tempRoot, 'resume-failed-calls.log');
  fs.rmSync(scopedSourceDir, { recursive: true, force: true });
  fs.rmSync(scopedOutputDir, { recursive: true, force: true });
  fs.rmSync(toolsDir, { recursive: true, force: true });
  fs.rmSync(callLogPath, { force: true });
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  for (const name of ['done-a.jpg', 'done-b.jpg', 'failed.jpg']) {
    fs.writeFileSync(path.join(scopedSourceDir, name), `source-${name}`, 'utf8');
  }

  const started = startCompressionSession({
    name: 'Failed image resume test',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced',
    imageToolCommand: writeFakeImageTool(toolsDir, callLogPath),
    videoToolCommand: '__missing_video_encoder__'
  });

  const db = getDb();
  const timestamp = new Date().toISOString();

  for (const name of ['done-a.jpg', 'done-b.jpg', 'failed.jpg']) {
    const sourcePath = path.join(scopedSourceDir, name);
    const outputPath = path.join(started.outputRoot, name);
    const itemId = `resume-${name}`;
    const status = name === 'failed.jpg' ? 'failed' : 'completed';
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, status === 'completed' ? `compressed-${name}` : `fallback-${name}`, 'utf8');

    db.prepare(
      `
        INSERT INTO media_items (
          id,
          session_id,
          source_path,
          relative_path,
          media_type,
          source_kind_detected,
          source_kind_override,
          size_bytes,
          capture_time,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'image', 'unknown', NULL, ?, NULL, ?, ?)
      `
    ).run(itemId, started.session.id, sourcePath, name, fs.statSync(outputPath).size, timestamp, timestamp);

    db.prepare(
      `
        INSERT INTO item_decisions (
          id,
          session_id,
          item_id,
          selected_for_compression,
          selected_for_output,
          target_group_label,
          user_overridden,
          updated_at
        ) VALUES (?, ?, ?, 1, 1, NULL, 0, ?)
      `
    ).run(`decision-${name}`, started.session.id, itemId, timestamp);

    db.prepare(
      `
        INSERT INTO item_stage_status (
          id,
          session_id,
          item_id,
          stage,
          status,
          attempt_count,
          last_error,
          updated_at
        ) VALUES (?, ?, ?, 'compress', ?, 1, ?, ?)
      `
    ).run(`status-${name}`, started.session.id, itemId, status, status === 'failed' ? 'Could not read image.' : null, timestamp);
  }

  db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('failed', started.session.id);
  db.prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?
      WHERE session_id = ? AND stage = 'compress'
    `
  ).run(
    JSON.stringify({
      outputRoot: started.outputRoot,
      manifest: started.manifest,
      totalCount: 3,
      summary: {
        completedItems: 2,
        failedItems: 1,
        totalCompressCount: 3,
        totalCopyCount: 0,
        completedCompressCount: 2,
        completedCopyCount: 0,
        failedCompressCount: 1,
        failedCopyCount: 0
      },
      processedItems: ['done-a.jpg', 'done-b.jpg', 'failed.jpg'].map((name) => ({
        source: path.join(scopedSourceDir, name),
        output: path.join(started.outputRoot, name),
        command: [],
        status: name === 'failed.jpg' ? 'failed' : 'completed',
        operation: 'compress',
        ...(name === 'failed.jpg' ? { error: 'Could not read image.' } : {})
      }))
    }),
    started.session.id
  );

  const resumed = startCompressionSessionResume(started.session.id);
  assert.equal(resumed?.accepted, true);
  assert.equal(resumed?.progress?.completed, 2);
  assert.equal(resumed?.progress?.failed, 1);

  await executeCompressionSession(started.session.id);

  const resumeSkipFile = path.join(started.outputRoot, '.media-organizer', 'resume-skip-images.json');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(resumeSkipFile, 'utf8')).map((item: { source: string }) => path.basename(item.source)).sort(),
    ['done-a.jpg', 'done-b.jpg']
  );

  const calls = fs.readFileSync(callLogPath, 'utf8').trim().split(/\r?\n/);
  assert.deepEqual(calls.map((value) => path.basename(value)), ['failed.jpg']);

  const progress = getCompressionProgress(started.session.id);
  assert.equal(progress?.status, 'completed');
  assert.equal(progress?.completed, 3);
  assert.equal(progress?.failed, 0);
});

test('failed compression resume replaces aliased failed items with completed results', async () => {
  const originalRealpathNative = fs.realpathSync.native;
  const { startCompressionSession, startCompressionSessionResume, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js?resume-failed-alias=1');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js?resume-failed-alias=1');
  const scopedSourceDir = path.join(tempRoot, 'resume-failed-alias-source');
  const scopedOutputDir = path.join(tempRoot, 'resume-failed-alias-output');
  const toolsDir = path.join(tempRoot, 'resume-failed-alias-tools');
  const callLogPath = path.join(tempRoot, 'resume-failed-alias-calls.log');
  const aliasSourceDir = path.join(tempRoot, 'resume-failed-alias-source-link');
  fs.rmSync(scopedSourceDir, { recursive: true, force: true });
  fs.rmSync(scopedOutputDir, { recursive: true, force: true });
  fs.rmSync(toolsDir, { recursive: true, force: true });
  fs.rmSync(callLogPath, { force: true });
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  fs.realpathSync.native = ((targetPath: fs.PathLike) => {
    const inputPath = String(targetPath);
    if (inputPath.startsWith(aliasSourceDir)) {
      return originalRealpathNative(inputPath.replace(aliasSourceDir, scopedSourceDir));
    }
    return originalRealpathNative(targetPath);
  }) as typeof fs.realpathSync.native;

  try {
    for (const name of ['done-a.jpg', 'done-b.jpg', 'failed.jpg']) {
      fs.writeFileSync(path.join(scopedSourceDir, name), `source-${name}`, 'utf8');
    }

    const started = startCompressionSession({
      name: 'Failed image resume alias test',
      sourceDir: scopedSourceDir,
      outputDir: scopedOutputDir,
      imageQuality: 80,
      imageProfileLabel: 'Balanced',
      videoPresetLabel: 'Balanced',
      imageToolCommand: writeFakeImageTool(toolsDir, callLogPath),
      videoToolCommand: '__missing_video_encoder__'
    });

    const db = getDb();
    const timestamp = new Date().toISOString();

    for (const name of ['done-a.jpg', 'done-b.jpg', 'failed.jpg']) {
      const sourcePath = path.join(scopedSourceDir, name);
      const outputPath = path.join(started.outputRoot, name);
      const itemId = `resume-alias-${name}`;
      const status = name === 'failed.jpg' ? 'failed' : 'completed';
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, status === 'completed' ? `compressed-${name}` : `fallback-${name}`, 'utf8');

      db.prepare(
        `
          INSERT INTO media_items (
            id,
            session_id,
            source_path,
            relative_path,
            media_type,
            source_kind_detected,
            source_kind_override,
            size_bytes,
            capture_time,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 'image', 'unknown', NULL, ?, NULL, ?, ?)
        `
      ).run(itemId, started.session.id, sourcePath, name, fs.statSync(outputPath).size, timestamp, timestamp);

      db.prepare(
        `
          INSERT INTO item_decisions (
            id,
            session_id,
            item_id,
            selected_for_compression,
            selected_for_output,
            target_group_label,
            user_overridden,
            updated_at
          ) VALUES (?, ?, ?, 1, 1, NULL, 0, ?)
        `
      ).run(`decision-alias-${name}`, started.session.id, itemId, timestamp);

      db.prepare(
        `
          INSERT INTO item_stage_status (
            id,
            session_id,
            item_id,
            stage,
            status,
            attempt_count,
            last_error,
            updated_at
          ) VALUES (?, ?, ?, 'compress', ?, 1, ?, ?)
        `
      ).run(`status-alias-${name}`, started.session.id, itemId, status, status === 'failed' ? 'Could not read image.' : null, timestamp);
    }

    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('failed', started.session.id);
    db.prepare(
      `
        UPDATE session_checkpoints
        SET payload_json = ?
        WHERE session_id = ? AND stage = 'compress'
      `
    ).run(
      JSON.stringify({
        outputRoot: started.outputRoot,
        manifest: started.manifest,
        totalCount: 3,
        summary: {
          completedItems: 2,
          failedItems: 1,
          totalCompressCount: 3,
          totalCopyCount: 0,
          completedCompressCount: 2,
          completedCopyCount: 0,
          failedCompressCount: 1,
          failedCopyCount: 0
        },
        processedItems: ['done-a.jpg', 'done-b.jpg', 'failed.jpg'].map((name) => ({
          source: path.join(name === 'failed.jpg' ? aliasSourceDir : scopedSourceDir, name),
          output: path.join(started.outputRoot, name),
          command: [],
          status: name === 'failed.jpg' ? 'failed' : 'completed',
          operation: 'compress',
          ...(name === 'failed.jpg' ? { error: 'Could not read image.' } : {})
        }))
      }),
      started.session.id
    );

    const resumed = startCompressionSessionResume(started.session.id);
    assert.equal(resumed?.accepted, true);
    assert.equal(resumed?.progress?.completed, 2);
    assert.equal(resumed?.progress?.failed, 1);

    await executeCompressionSession(started.session.id);

    const progress = getCompressionProgress(started.session.id);
    assert.equal(progress?.status, 'completed');
    assert.equal(progress?.completed, 3);
    assert.equal(progress?.failed, 0);
    assert.equal(progress?.processedItems.filter((item) => item.status === 'failed').length, 0);
    assert.equal(progress?.processedItems.filter((item) => path.basename(item.sourcePath) === 'failed.jpg').length, 1);
  } finally {
    fs.realpathSync.native = originalRealpathNative;
  }
});

test('fatal compression resume errors preserve existing failed item counts', async () => {
  const { startCompressionSession, markCompressionSessionFailed, getCompressionProgress, getCompressionSession } = await import('../src/pipeline/compression/compressionJob.service.js?fatal-resume-counts=1');
  const scopedSourceDir = path.join(tempRoot, 'fatal-resume-source');
  const scopedOutputDir = path.join(tempRoot, 'fatal-resume-output');
  fs.rmSync(scopedSourceDir, { recursive: true, force: true });
  fs.rmSync(scopedOutputDir, { recursive: true, force: true });
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });

  const started = startCompressionSession({
    name: 'Fatal resume count test',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced'
  });

  const processedItems = ['failed-a.jpg', 'failed-b.jpg'].map((name) => {
    const sourcePath = path.join(scopedSourceDir, name);
    fs.writeFileSync(sourcePath, `source-${name}`, 'utf8');

    return {
      source: sourcePath,
      output: path.join(started.outputRoot, name),
      command: [],
      status: 'failed',
      operation: 'compress',
      error: 'Could not read image.'
    };
  });

  getDb().prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?
      WHERE session_id = ? AND stage = 'compress'
    `
  ).run(
    JSON.stringify({
      outputRoot: started.outputRoot,
      manifest: started.manifest,
      totalCount: 2,
      summary: {
        completedItems: 0,
        failedItems: 0,
        totalCompressCount: 2,
        totalCopyCount: 0,
        completedCompressCount: 0,
        completedCopyCount: 0,
        failedCompressCount: 0,
        failedCopyCount: 0
      },
      processedItems
    }),
    started.session.id
  );

  markCompressionSessionFailed(started.session.id, new Error('spawn ENAMETOOLONG'));

  const progress = getCompressionProgress(started.session.id);
  assert.equal(progress?.failed, 2);
  assert.equal(progress?.fatalError, 'spawn ENAMETOOLONG');

  const checkpointPayload = JSON.parse(getCompressionSession(started.session.id)?.checkpoint?.payloadJson ?? '{}');
  assert.equal(checkpointPayload.summary.failedItems, 2);
  assert.equal(checkpointPayload.fatalError, 'spawn ENAMETOOLONG');
  assert.equal(checkpointPayload.timing.segments.at(-1).reason, 'fail');
  const historyRow = getDb().prepare(
    'SELECT compression_active_duration_ms, compression_active_started_at FROM execution_history WHERE session_id = ?'
  ).get(started.session.id) as { compression_active_duration_ms: number | null; compression_active_started_at: string | null };
  assert.equal(historyRow.compression_active_started_at, null);
  assert.equal(typeof historyRow.compression_active_duration_ms, 'number');
});

test('interrupted compression sessions pause on startup and resume only unconfirmed image outputs', async () => {
  const {
    startCompressionSession,
    getCompressionProgress,
    getCompressionSession,
    markCompressionSessionRunning,
    reconcileInterruptedCompressionSessions
  } = await import('../src/pipeline/compression/compressionJob.service.js?resume-interrupted=1');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js?resume-interrupted=1');
  const scopedSourceDir = path.join(tempRoot, 'resume-image-source');
  const scopedOutputDir = path.join(tempRoot, 'resume-image-output');
  const toolsDir = path.join(tempRoot, 'resume-image-tools');
  const callLogPath = path.join(tempRoot, 'resume-image-calls.log');
  fs.rmSync(scopedSourceDir, { recursive: true, force: true });
  fs.rmSync(scopedOutputDir, { recursive: true, force: true });
  fs.rmSync(toolsDir, { recursive: true, force: true });
  fs.rmSync(callLogPath, { force: true });
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  for (const name of ['one.jpg', 'two.jpg', 'three.jpg', 'four.jpg']) {
    fs.writeFileSync(path.join(scopedSourceDir, name), `source-${name}`, 'utf8');
  }

  const started = startCompressionSession({
    name: 'Interrupted image resume test',
    sourceDir: scopedSourceDir,
    outputDir: scopedOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced',
    imageToolCommand: writeFakeImageTool(toolsDir, callLogPath),
    videoToolCommand: '__missing_video_encoder__'
  });

  const db = getDb();
  const timestamp = new Date().toISOString();
  const insertMedia = db.prepare(
    `
      INSERT INTO media_items (
        id,
        session_id,
        source_path,
        relative_path,
        media_type,
        source_kind_detected,
        source_kind_override,
        size_bytes,
        capture_time,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'image', 'unknown', NULL, ?, NULL, ?, ?)
    `
  );
  const insertDecision = db.prepare(
    `
      INSERT INTO item_decisions (
        id,
        session_id,
        item_id,
        selected_for_compression,
        selected_for_output,
        target_group_label,
        user_overridden,
        updated_at
      ) VALUES (?, ?, ?, 1, 1, NULL, 0, ?)
    `
  );
  const insertStatus = db.prepare(
    `
      INSERT INTO item_stage_status (
        id,
        session_id,
        item_id,
        stage,
        status,
        attempt_count,
        last_error,
        updated_at
      ) VALUES (?, ?, ?, 'compress', 'completed', 1, NULL, ?)
    `
  );
  const completedItems = ['one.jpg', 'two.jpg'];

  for (const name of completedItems) {
    const sourcePath = path.join(scopedSourceDir, name);
    const outputPath = path.join(scopedOutputDir, name);
    const itemId = `item-${name}`;
    fs.writeFileSync(outputPath, `compressed-${name}`, 'utf8');
    insertMedia.run(itemId, started.session.id, sourcePath, name, fs.statSync(outputPath).size, timestamp, timestamp);
    insertDecision.run(`decision-${name}`, started.session.id, itemId, timestamp);
    insertStatus.run(`status-${name}`, started.session.id, itemId, timestamp);
  }

  const interruptedSource = path.join(scopedSourceDir, 'four.jpg');
  const interruptedOutput = path.join(scopedOutputDir, 'four.jpg');
  const interruptedTempOutput = path.join(scopedOutputDir, `.four.jpg.media-organizer-tmp-stale.jpg`);
  fs.writeFileSync(interruptedTempOutput, 'partial', 'utf8');
  db.prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?
      WHERE session_id = ? AND stage = 'compress'
    `
  ).run(
    JSON.stringify({
      outputRoot: started.outputRoot,
      manifest: started.manifest,
      totalCount: 4,
      summary: {
        completedItems: 2,
        failedItems: 0,
        totalCompressCount: 4,
        totalCopyCount: 0,
        completedCompressCount: 2,
        completedCopyCount: 0,
        failedCompressCount: 0,
        failedCopyCount: 0
      },
      activeItems: [{ id: interruptedSource, sourcePath: interruptedSource, operation: 'compress', startedAt: Date.now() }],
      timing: { segments: [{ startedAt: started.session.createdAt }] },
      processedItems: completedItems.map((name) => ({
        source: path.join(scopedSourceDir, name),
        output: path.join(scopedOutputDir, name),
        command: [],
        status: 'completed',
        operation: 'compress'
      }))
    }),
    started.session.id
  );

  assert.ok(reconcileInterruptedCompressionSessions() >= 1);
  assert.equal(getCompressionSession(started.session.id)?.session.status, 'paused');
  assert.equal(getCompressionProgress(started.session.id)?.currentlyProcessing.length, 0);
  const interruptedPayload = JSON.parse(getCompressionSession(started.session.id)?.checkpoint?.payloadJson ?? '{}') as {
    timing?: { segments?: Array<{ endedAt?: string; reason?: string }> };
  };
  assert.equal(interruptedPayload.timing?.segments?.at(-1)?.reason, 'interrupted');
  assert.equal(typeof interruptedPayload.timing?.segments?.at(-1)?.endedAt, 'string');
  const interruptedHistory = db.prepare(
    'SELECT status, compression_active_duration_ms, compression_active_started_at FROM execution_history WHERE session_id = ?'
  ).get(started.session.id) as { status: string; compression_active_duration_ms: number | null; compression_active_started_at: string | null };
  assert.equal(interruptedHistory.status, 'paused');
  assert.equal(interruptedHistory.compression_active_started_at, null);
  assert.equal(typeof interruptedHistory.compression_active_duration_ms, 'number');

  markCompressionSessionRunning(started.session.id);
  await executeCompressionSession(started.session.id);

  const calls = fs.readFileSync(callLogPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((value) => path.basename(value)).sort(), ['four.jpg', 'three.jpg']);
  assert.equal(fs.existsSync(interruptedTempOutput), false);
  assert.equal(fs.readFileSync(path.join(scopedOutputDir, 'one.jpg'), 'utf8'), 'compressed-one.jpg');
  assert.equal(fs.readFileSync(path.join(scopedOutputDir, 'two.jpg'), 'utf8'), 'compressed-two.jpg');
  assert.equal(fs.readFileSync(path.join(scopedOutputDir, 'three.jpg'), 'utf8'), 'source-three.jpg');
  assert.equal(fs.readFileSync(interruptedOutput, 'utf8'), 'source-four.jpg');

  const progress = getCompressionProgress(started.session.id);
  assert.equal(progress?.status, 'completed');
  assert.equal(progress?.completed, 4);
  assert.equal(progress?.failed, 0);
});
