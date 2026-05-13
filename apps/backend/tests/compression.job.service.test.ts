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

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as { imageToolCommand: string; videoToolCommand: string };
  assert.equal(manifest.imageToolCommand, 'cjpeg');
  assert.equal(manifest.videoToolCommand, 'HandBrakeCLI');

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