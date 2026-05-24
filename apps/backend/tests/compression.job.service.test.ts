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
timeout /t ${delaySeconds} /nobreak >nul
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
    imageMagickCommand: string;
    exifToolCommand: string;
  };
  assert.equal(manifest.imageToolCommand, 'cjpeg');
  assert.equal(manifest.videoToolCommand, 'HandBrakeCLI');
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

  for (let attempt = 0; attempt < 30 && !activeProgress?.currentlyProcessing.length; attempt += 1) {
    await sleep(100);
    activeProgress = getCompressionProgress(started.session.id);
  }

  assert.equal(activeProgress?.currentlyProcessing.length, 1);
  assert.equal(activeProgress?.currentlyProcessing[0].operation, 'compress');
  assert.ok(activeProgress?.currentlyProcessing[0].sourcePath.endsWith('slow.mp4'));

  await execution;

  const finalProgress = getCompressionProgress(started.session.id);
  assert.ok(finalProgress);
  assert.equal(finalProgress?.status, 'completed');
  assert.equal(finalProgress?.currentlyProcessing.length, 0);
  assert.equal(finalProgress?.processedItems.length, 1);
  assert.equal(finalProgress?.processedItems[0].operation, 'compress');
});
