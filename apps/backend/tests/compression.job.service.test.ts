import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-compression-test-'));
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
    videoToolCommand: string;
    videoOutputFormatMode: string;
    imageMagickCommand: string;
    exifToolCommand: string;
  };
  assert.equal(manifest.imageToolCommand, 'cjpeg');
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

test('compression progress reports the actively processing video and clears it after completion', async () => {
  const { startCompressionSession, getCompressionProgress } = await import('../src/pipeline/compression/compressionJob.service.js');
  const { executeCompressionSession } = await import('../src/pipeline/compression/compressionJob.runner.js');
  const scopedSourceDir = path.join(tempRoot, 'active-video-source');
  const scopedOutputDir = path.join(tempRoot, 'active-video-output');
  const toolsDir = path.join(tempRoot, 'active-video-tools');
  fs.mkdirSync(scopedSourceDir, { recursive: true });
  fs.mkdirSync(scopedOutputDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(scopedSourceDir, 'slow.mp4'), 'fake-video-content', 'utf8');

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
  assert.equal(typeof activeProgress?.currentlyProcessing[0].startedAt, 'number');

  await execution;

  const finalProgress = getCompressionProgress(started.session.id);
  assert.ok(finalProgress);
  assert.equal(finalProgress?.status, 'completed');
  assert.equal(finalProgress?.currentlyProcessing.length, 0);
  assert.equal(finalProgress?.processedItems.length, 1);
  assert.equal(finalProgress?.processedItems[0].operation, 'compress');
  assert.equal(typeof finalProgress?.processedItems[0].durationMs, 'number');
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
