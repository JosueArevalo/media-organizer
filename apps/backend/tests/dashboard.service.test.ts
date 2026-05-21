import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-dashboard-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');
const sourceDir = path.join(tempRoot, 'source');
const outputDir = path.join(tempRoot, 'output');

beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  fs.rmSync(tempDbPath, { force: true });
  resetDbForTests();
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  resetDbForTests();
});

test('dashboard history can be listed and deleted independently', async () => {
  const { upsertExecutionHistory, listExecutionHistory, getDashboardSummary, deleteExecutionHistory } = await import('../src/dashboard/dashboard.service.js');

  const execution = upsertExecutionHistory({
    sessionId: 'session-1',
    name: 'May cleanup',
    sourceDir,
    outputDir,
    outputRoot: path.join(outputDir, 'compressed'),
    status: 'completed',
    startedAt: '2026-05-20T10:00:00.000Z',
    finishedAt: '2026-05-20T10:10:00.000Z',
    updatedAt: '2026-05-20T10:10:00.000Z',
    totalItems: 3,
    imageItems: 2,
    videoItems: 1,
    completedItems: 3,
    failedItems: 0,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    errorSummary: []
  });

  assert.equal(listExecutionHistory().length, 1);
  assert.equal(getDashboardSummary().totals.filesProcessed, 3);
  assert.equal(deleteExecutionHistory(execution.id), true);
  assert.equal(listExecutionHistory().length, 0);
});

test('runtime reset tables do not remove execution history', async () => {
  const { runMigrations } = await import('../src/state/migrations/runMigrations.js?dashboard-reset=1');
  const { upsertExecutionHistory, listExecutionHistory } = await import('../src/dashboard/dashboard.service.js?dashboard-reset=1');

  runMigrations();
  upsertExecutionHistory({
    sessionId: 'session-2',
    name: null,
    sourceDir,
    outputDir,
    outputRoot: null,
    status: 'failed',
    startedAt: '2026-05-20T10:00:00.000Z',
    finishedAt: '2026-05-20T10:05:00.000Z',
    updatedAt: '2026-05-20T10:05:00.000Z',
    totalItems: 2,
    imageItems: 1,
    videoItems: 1,
    completedItems: 1,
    failedItems: 1,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: [{ source: path.join(sourceDir, 'clip.mp4'), error: 'Tool failed' }]
  });

  const db = getDb();
  db.exec(`
    BEGIN TRANSACTION;
    DELETE FROM session_checkpoints;
    DELETE FROM item_stage_status;
    DELETE FROM item_decisions;
    DELETE FROM media_items;
    DELETE FROM sessions;
    COMMIT;
  `);

  const executions = listExecutionHistory();
  assert.equal(executions.length, 1);
  assert.equal(executions[0].failedItems, 1);
});
