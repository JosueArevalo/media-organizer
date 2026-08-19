import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-export-summary-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');

beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  fs.rmSync(tempDbPath, { force: true });
  resetDbForTests();
});

afterEach(() => {
  resetDbForTests();
});

const createExecution = async () => {
  const { upsertExecutionHistory, linkGroupingExecution } = await import('../src/dashboard/dashboard.service.js?export-summary=execution');
  const execution = upsertExecutionHistory({
    sessionId: 'compression-1',
    name: 'Export summary',
    sourceDir: 'source',
    outputDir: 'output',
    outputRoot: 'organized',
    status: 'completed',
    startedAt: '2026-06-01T10:00:00.000Z',
    finishedAt: '2026-06-01T10:05:00.000Z',
    updatedAt: '2026-06-01T10:05:00.000Z',
    totalItems: 5,
    imageItems: 5,
    videoItems: 0,
    completedItems: 5,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });
  linkGroupingExecution('compression-1', 'grouping-1');
  return execution;
};

const insertJob = (input: {
  id: string;
  executionId: string;
  provider: 'network-folder' | 'google-photos';
  status: 'completed' | 'failed' | 'paused';
  eligibleItems: number;
  eligibleAlbums?: number;
  destination: string;
  updatedAt: string;
  error?: string | null;
}) => {
  getDb().prepare(
    `INSERT INTO export_jobs (
      id, name, source_root, target_type, target_path, execution_id, destination_label,
      eligible_items, eligible_albums, status, total_items, completed_items, failed_items,
      skipped_items, last_error, created_at, updated_at, last_opened_at
    ) VALUES (?, NULL, 'organized', ?, NULL, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.provider,
    input.executionId,
    input.destination,
    input.eligibleItems,
    input.eligibleAlbums ?? 0,
    input.status,
    input.error ?? null,
    input.updatedAt,
    input.updatedAt,
    input.updatedAt
  );
};

const insertItem = (jobId: string, sourcePath: string, destinationPath: string, status: 'completed' | 'skipped' | 'failed') => {
  getDb().prepare(
    `INSERT INTO export_items (
      id, job_id, source_path, relative_path, destination_path, size_bytes, status, attempt_count, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 1, NULL, '2026-06-01T10:10:00.000Z')`
  ).run(`${jobId}:${sourcePath}`, jobId, sourcePath, sourcePath, destinationPath, status);
};

test('provider summaries union repeated files and preserve completed coverage after a later failure', async () => {
  const execution = await createExecution();
  const { listExportProviderSummaries } = await import('../src/pipeline/export/exportSummary.service.js?network-summary=1');

  insertJob({
    id: 'network-1',
    executionId: execution.id,
    provider: 'network-folder',
    status: 'completed',
    eligibleItems: 2,
    destination: '\\\\nas\\photos',
    updatedAt: '2026-06-01T10:10:00.000Z'
  });
  insertItem('network-1', 'a.jpg', 'a.jpg', 'completed');
  insertItem('network-1', 'b.jpg', 'b.jpg', 'skipped');

  insertJob({
    id: 'network-2',
    executionId: execution.id,
    provider: 'network-folder',
    status: 'failed',
    eligibleItems: 2,
    destination: '\\\\nas\\backup',
    updatedAt: '2026-06-01T10:20:00.000Z',
    error: 'Network unavailable'
  });
  insertItem('network-2', 'a.jpg', 'a.jpg', 'completed');

  const network = listExportProviderSummaries({ executionId: execution.id }).find((summary) => summary.provider === 'network-folder');
  assert.equal(network?.coverageStatus, 'completed');
  assert.equal(network?.displayStatus, 'attention');
  assert.equal(network?.coveredItems, 2);
  assert.equal(network?.completedJobs, 1);
  assert.equal(network?.lastAttempt?.status, 'failed');
  assert.equal(network?.completedDestinations[0].label, '\\\\nas\\photos');
});

test('separate Google Photos album jobs combine into complete provider coverage', async () => {
  const execution = await createExecution();
  const { listExportProviderSummaries } = await import('../src/pipeline/export/exportSummary.service.js?google-summary=1');

  insertJob({
    id: 'google-1',
    executionId: execution.id,
    provider: 'google-photos',
    status: 'completed',
    eligibleItems: 3,
    eligibleAlbums: 2,
    destination: 'user@example.com',
    updatedAt: '2026-06-01T10:10:00.000Z'
  });
  insertItem('google-1', 'a.jpg', 'Album A', 'completed');

  insertJob({
    id: 'google-2',
    executionId: execution.id,
    provider: 'google-photos',
    status: 'completed',
    eligibleItems: 3,
    eligibleAlbums: 2,
    destination: 'user@example.com',
    updatedAt: '2026-06-01T10:20:00.000Z'
  });
  insertItem('google-2', 'b.jpg', 'Album B', 'completed');
  insertItem('google-2', 'c.jpg', 'Album B', 'completed');

  const google = listExportProviderSummaries({ groupingSessionId: 'grouping-1' }).find((summary) => summary.provider === 'google-photos');
  assert.equal(google?.coverageStatus, 'completed');
  assert.equal(google?.displayStatus, 'completed');
  assert.equal(google?.coveredItems, 3);
  assert.equal(google?.coveredAlbums, 2);
  assert.equal(google?.completedJobs, 2);
  assert.equal(google?.completedDestinations[0].completedJobs, 2);
});

test('Google Photos completed selected album job is complete even when other albums were excluded', async () => {
  const execution = await createExecution();
  const { listExportProviderSummaries } = await import('../src/pipeline/export/exportSummary.service.js?google-selected-summary=1');

  insertJob({
    id: 'google-full-attempt',
    executionId: execution.id,
    provider: 'google-photos',
    status: 'failed',
    eligibleItems: 3,
    eligibleAlbums: 3,
    destination: 'user@example.com',
    updatedAt: '2026-06-01T10:10:00.000Z',
    error: 'User stopped before private album'
  });
  insertItem('google-full-attempt', 'a.jpg', 'Album A', 'failed');

  insertJob({
    id: 'google-selected',
    executionId: execution.id,
    provider: 'google-photos',
    status: 'completed',
    eligibleItems: 2,
    eligibleAlbums: 2,
    destination: 'user@example.com',
    updatedAt: '2026-06-01T10:20:00.000Z'
  });
  insertItem('google-selected', 'a.jpg', 'Album A', 'completed');
  insertItem('google-selected', 'b.jpg', 'Album B', 'completed');

  const google = listExportProviderSummaries({ executionId: execution.id }).find((summary) => summary.provider === 'google-photos');
  assert.equal(google?.coverageStatus, 'completed');
  assert.equal(google?.displayStatus, 'attention');
  assert.equal(google?.eligibleItems, 2);
  assert.equal(google?.coveredItems, 2);
  assert.equal(google?.eligibleAlbums, 2);
  assert.equal(google?.coveredAlbums, 2);
  assert.equal(google?.lastAttempt?.status, 'completed');
});

test('Google Photos selected album summaries expand when another selected album is uploaded later', async () => {
  const execution = await createExecution();
  const { listExportProviderSummaries } = await import('../src/pipeline/export/exportSummary.service.js?google-incremental-selected-summary=1');

  insertJob({
    id: 'google-selected-first',
    executionId: execution.id,
    provider: 'google-photos',
    status: 'completed',
    eligibleItems: 2,
    eligibleAlbums: 2,
    destination: 'user@example.com',
    updatedAt: '2026-06-01T10:10:00.000Z'
  });
  insertItem('google-selected-first', 'a.jpg', 'Album A', 'completed');
  insertItem('google-selected-first', 'b.jpg', 'Album B', 'completed');

  insertJob({
    id: 'google-selected-second',
    executionId: execution.id,
    provider: 'google-photos',
    status: 'completed',
    eligibleItems: 1,
    eligibleAlbums: 1,
    destination: 'user@example.com',
    updatedAt: '2026-06-01T10:20:00.000Z'
  });
  insertItem('google-selected-second', 'c.jpg', 'Album C', 'completed');

  const google = listExportProviderSummaries({ executionId: execution.id }).find((summary) => summary.provider === 'google-photos');
  assert.equal(google?.coverageStatus, 'completed');
  assert.equal(google?.eligibleItems, 3);
  assert.equal(google?.coveredItems, 3);
  assert.equal(google?.eligibleAlbums, 3);
  assert.equal(google?.coveredAlbums, 3);
});

test('a paused Google Photos job counts only fully completed albums', async () => {
  const execution = await createExecution();
  const { listExportProviderSummaries } = await import('../src/pipeline/export/exportSummary.service.js?google-paused-summary=1');

  insertJob({
    id: 'google-paused',
    executionId: execution.id,
    provider: 'google-photos',
    status: 'paused',
    eligibleItems: 4,
    eligibleAlbums: 2,
    destination: 'user@example.com',
    updatedAt: '2026-06-01T10:20:00.000Z'
  });
  insertItem('google-paused', 'a.jpg', 'Album A', 'completed');
  insertItem('google-paused', 'b.jpg', 'Album A', 'completed');
  insertItem('google-paused', 'c.jpg', 'Album B', 'completed');
  insertItem('google-paused', 'd.jpg', 'Album B', 'failed');

  const google = listExportProviderSummaries({ executionId: execution.id }).find((summary) => summary.provider === 'google-photos');
  assert.equal(google?.coverageStatus, 'partial');
  assert.equal(google?.coveredItems, 3);
  assert.equal(google?.coveredAlbums, 1);
  assert.equal(google?.completedJobs, 0);
  assert.equal(google?.lastAttempt?.status, 'paused');
});

test('unlinked jobs are reconciled to the latest matching execution before the export', async () => {
  const execution = await createExecution();
  const { listExportProviderSummaries } = await import('../src/pipeline/export/exportSummary.service.js?reconcile-summary=1');

  insertJob({
    id: 'unlinked-network',
    executionId: execution.id,
    provider: 'network-folder',
    status: 'completed',
    eligibleItems: 1,
    destination: '\\\\nas\\reconciled',
    updatedAt: '2026-06-01T10:10:00.000Z'
  });
  getDb().prepare('UPDATE export_jobs SET execution_id = NULL, source_root = ?, created_at = ? WHERE id = ?')
    .run('organized', '2026-06-01T10:10:00.000Z', 'unlinked-network');
  insertItem('unlinked-network', 'a.jpg', 'a.jpg', 'completed');

  const network = listExportProviderSummaries({ sourceRoot: 'organized' }).find((summary) => summary.provider === 'network-folder');
  assert.equal(network?.coverageStatus, 'completed');
  assert.equal(getDb().prepare('SELECT execution_id FROM export_jobs WHERE id = ?').get('unlinked-network').execution_id, execution.id);
});
