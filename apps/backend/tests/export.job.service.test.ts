import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-export-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');
const sourceRoot = path.join(tempRoot, 'source');
const destinationRoot = path.join(tempRoot, 'destination');

const resetFolders = () => {
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(sourceRoot, '2026.04 - Trip'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.media-organizer'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'video-a.mp4'), 'video-a');
  fs.writeFileSync(path.join(sourceRoot, '.media-organizer', 'manifest.json'), '{}');
};

beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  fs.rmSync(tempDbPath, { force: true });
  resetDbForTests();
  resetFolders();
});

afterEach(() => {
  resetDbForTests();
});

test('collectExportFilePlan preserves nested relative paths and ignores internal manifests', async () => {
  const { collectExportFilePlan } = await import('../src/pipeline/export/exportJob.service.js');

  const plan = collectExportFilePlan(sourceRoot, destinationRoot);

  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((item) => item.relativePath).sort(), [
    path.join('2026.04 - Trip', 'photo-a.jpg'),
    path.join('2026.04 - Trip', 'video-a.mp4')
  ]);
  assert.ok(plan.every((item) => item.destinationPath.startsWith(destinationRoot)));
});

test('executeExportJob copies files and skips already matching destination files on retry', async () => {
  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js');

  const job = createExportJob({
    sourceRoot,
    target: { type: 'network-folder', destinationPath: destinationRoot }
  });

  await executeExportJob(job.job.id);

  const copiedPath = path.join(destinationRoot, '2026.04 - Trip', 'photo-a.jpg');
  assert.equal(fs.readFileSync(copiedPath, 'utf8'), 'image-a');

  const db = getDb();
  db.prepare("UPDATE export_items SET status = 'pending' WHERE job_id = ?").run(job.job.id);
  db.prepare("UPDATE export_jobs SET status = 'draft', completed_items = 0, skipped_items = 0 WHERE id = ?").run(job.job.id);

  await executeExportJob(job.job.id);

  const progress = getExportProgress(job.job.id);
  assert.equal(progress?.status, 'completed');
  assert.equal(progress?.completed, 0);
  assert.equal(progress?.skipped, 2);
});

test('retryFailedExportItems only resets failed items before resuming export', async () => {
  const { createExportJob, getExportProgress, retryFailedExportItems } = await import('../src/pipeline/export/exportJob.service.js');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js');

  const job = createExportJob({
    sourceRoot,
    target: { type: 'network-folder', destinationPath: destinationRoot }
  });
  const db = getDb();
  const rows = db.prepare('SELECT id FROM export_items WHERE job_id = ? ORDER BY relative_path ASC').all(job.job.id) as Array<{ id: string }>;

  db.prepare("UPDATE export_items SET status = 'completed' WHERE id = ?").run(rows[0].id);
  db.prepare("UPDATE export_items SET status = 'failed', last_error = 'network lost' WHERE id = ?").run(rows[1].id);
  db.prepare("UPDATE export_jobs SET status = 'failed', completed_items = 1, failed_items = 1 WHERE id = ?").run(job.job.id);

  retryFailedExportItems(job.job.id);

  const statuses = db
    .prepare('SELECT status FROM export_items WHERE job_id = ? ORDER BY relative_path ASC')
    .all(job.job.id) as Array<{ status: string }>;

  assert.deepEqual(statuses.map((row) => row.status), ['completed', 'pending']);

  await executeExportJob(job.job.id);

  const progress = getExportProgress(job.job.id);
  assert.equal(progress?.status, 'completed');
  assert.equal(progress?.failed, 0);
  assert.equal(progress?.completed, 2);
});

test('pauseExportJob and start/resume APIs keep resumable job state', async () => {
  const { createExportJob, pauseExportJob, getExportJob } = await import('../src/pipeline/export/exportJob.service.js');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js');

  const job = createExportJob({
    sourceRoot,
    target: { type: 'network-folder', destinationPath: destinationRoot }
  });

  assert.equal(job.job.status, 'draft');
  assert.equal(job.job.totalItems, 2);

  const paused = pauseExportJob(job.job.id);
  assert.equal(paused?.job.status, 'paused');

  await executeExportJob(job.job.id);

  const completed = getExportJob(job.job.id);
  assert.equal(completed?.job.status, 'completed');
  assert.equal(completed?.job.completedItems, 2);
});
