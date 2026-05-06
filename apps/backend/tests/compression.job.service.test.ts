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

test('startCompressionJob creates a resumable job and output scaffold', async () => {
  const { startCompressionJob, getCompressionJob } = await import('../src/pipeline/compression/compressionJob.service.js?test=1');

  const result = startCompressionJob({
    name: 'Test compression job',
    sourceDir,
    outputDir,
    imageQuality: 82,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Balanced'
  });

  assert.equal(result.job.status, 'running');
  assert.match(result.outputRoot, new RegExp(`^${outputDir.replace(/\\/g, '\\\\')}`));
  assert.ok(fs.existsSync(result.outputRoot));
  assert.ok(fs.existsSync(result.manifestPath));

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as { imageToolCommand: string; videoToolCommand: string };
  assert.equal(manifest.imageToolCommand, 'cjpeg');
  assert.equal(manifest.videoToolCommand, 'HandBrakeCLI');

  const persisted = getCompressionJob(result.job.id);
  assert.ok(persisted);
  assert.equal(persisted?.job.status, 'running');
  assert.equal(persisted?.checkpoint?.stage, 'compress');

  const db = getDb();
  const jobRows = db.prepare('SELECT id, status, source_dir, output_dir FROM jobs WHERE id = ?').all(result.job.id) as Array<{
    id: string;
    status: string;
    source_dir: string;
    output_dir: string;
  }>;

  assert.equal(jobRows.length, 1);
  assert.equal(jobRows[0].status, 'running');
  assert.equal(jobRows[0].source_dir, sourceDir);
  assert.equal(jobRows[0].output_dir, outputDir);

  const checkpointRows = db.prepare('SELECT stage, payload_json FROM job_checkpoints WHERE job_id = ?').all(result.job.id) as Array<{
    stage: string;
    payload_json: string | null;
  }>;

  assert.equal(checkpointRows.length, 1);
  assert.equal(checkpointRows[0].stage, 'compress');
  assert.ok(checkpointRows[0].payload_json?.includes('outputRoot'));
});