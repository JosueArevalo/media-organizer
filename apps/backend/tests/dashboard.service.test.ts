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
    originalBytes: 3000,
    finalBytes: 2100,
    compressionActiveDurationMs: 120000,
    compressionActiveStartedAt: null,
    imageProfileLabel: 'Balanced',
    imageQuality: 80,
    videoPresetLabel: 'Fast 1080p30',
    errorSummary: []
  });

  assert.equal(listExecutionHistory().length, 1);
  assert.equal(listExecutionHistory()[0].originalBytes, 3000);
  assert.equal(listExecutionHistory()[0].finalBytes, 2100);
  assert.equal(listExecutionHistory()[0].compressionActiveDurationMs, 120000);
  assert.equal(listExecutionHistory()[0].compressionActiveStartedAt, null);
  assert.equal(listExecutionHistory()[0].imageQuality, 80);
  assert.equal(getDashboardSummary().totals.filesProcessed, 3);
  assert.equal(deleteExecutionHistory(execution.id), true);
  assert.equal(listExecutionHistory().length, 0);
});

test('dashboard serializes verification snapshots and defaults old executions to not verified', async () => {
  const { upsertExecutionHistory, listExecutionHistory } = await import('../src/dashboard/dashboard.service.js?dashboard-verification=1');

  upsertExecutionHistory({
    sessionId: 'session-with-verification',
    name: 'Verified run',
    sourceDir,
    outputDir,
    outputRoot: outputDir,
    status: 'completed',
    startedAt: '2026-05-20T10:00:00.000Z',
    finishedAt: '2026-05-20T10:10:00.000Z',
    updatedAt: '2026-05-20T10:10:00.000Z',
    totalItems: 2,
    imageItems: 1,
    videoItems: 1,
    completedItems: 2,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });

  upsertExecutionHistory({
    sessionId: 'session-without-verification',
    name: 'Legacy run',
    sourceDir,
    outputDir,
    outputRoot: outputDir,
    status: 'completed',
    startedAt: '2026-05-21T10:00:00.000Z',
    finishedAt: '2026-05-21T10:10:00.000Z',
    updatedAt: '2026-05-21T10:10:00.000Z',
    totalItems: 1,
    imageItems: 1,
    videoItems: 0,
    completedItems: 1,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });

  const db = getDb();
  db.prepare('UPDATE execution_history SET verification_json = ? WHERE session_id = ?').run(
    JSON.stringify({
      status: 'ok',
      expected: { total: 2, images: 1, videos: 1, unknown: 0 },
      destination: { total: 2, images: 1, videos: 1, unknown: 0 },
      verifiedAt: '2026-05-20T10:09:00.000Z',
      outputRoot: outputDir
    }),
    'session-with-verification'
  );

  const executions = listExecutionHistory();
  const verified = executions.find((execution) => execution.sessionId === 'session-with-verification');
  const legacy = executions.find((execution) => execution.sessionId === 'session-without-verification');

  assert.equal(verified?.verification.status, 'ok');
  assert.deepEqual(verified?.verification.destination, { total: 2, images: 1, videos: 1, unknown: 0 });
  assert.equal(legacy?.verification.status, 'not_verified');
  assert.deepEqual(legacy?.verification.expected, { total: 0, images: 0, videos: 0, unknown: 0 });
  assert.equal(legacy?.originalBytes, null);
  assert.equal(legacy?.finalBytes, null);
  assert.equal(legacy?.compressionActiveDurationMs, null);
  assert.equal(legacy?.compressionActiveStartedAt, null);
  assert.equal(legacy?.imageQuality, null);
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

test('paused execution history does not count as current dashboard progress', async () => {
  const { upsertExecutionHistory, getDashboardSummary } = await import('../src/dashboard/dashboard.service.js?dashboard-paused-current=1');

  upsertExecutionHistory({
    sessionId: 'paused-session',
    name: 'Interrupted run',
    sourceDir,
    outputDir,
    outputRoot: outputDir,
    status: 'paused',
    startedAt: '2026-06-01T10:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-06-01T10:02:00.000Z',
    totalItems: 6,
    imageItems: 6,
    videoItems: 0,
    completedItems: 3,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });

  const summary = getDashboardSummary();
  assert.equal(summary.currentExecution, null);
  assert.equal(summary.lastExecution?.status, 'paused');
});

test('new compression session pauses older non-terminal execution history', async () => {
  const { upsertExecutionHistory, listExecutionHistory } = await import('../src/dashboard/dashboard.service.js?dashboard-new-session=1');
  const { startCompressionSession } = await import('../src/pipeline/compression/compressionJob.service.js?dashboard-new-session=1');

  upsertExecutionHistory({
    sessionId: 'old-running-session',
    name: 'Old run',
    sourceDir,
    outputDir,
    outputRoot: outputDir,
    status: 'running',
    startedAt: '2026-06-01T10:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-06-01T10:02:00.000Z',
    totalItems: 6,
    imageItems: 6,
    videoItems: 0,
    completedItems: 3,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });

  const nextSourceDir = path.join(tempRoot, 'next-source');
  const nextOutputDir = path.join(tempRoot, 'next-output');
  fs.mkdirSync(nextSourceDir, { recursive: true });
  fs.mkdirSync(nextOutputDir, { recursive: true });

  const started = startCompressionSession({
    name: 'Next run',
    sourceDir: nextSourceDir,
    outputDir: nextOutputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: '__missing_video_encoder__'
  });

  const executions = listExecutionHistory();
  const oldExecution = executions.find((execution) => execution.sessionId === 'old-running-session');
  const newExecution = executions.find((execution) => execution.sessionId === started.session.id);

  assert.equal(oldExecution?.status, 'paused');
  assert.equal(newExecution?.status, 'running');
  assert.equal(executions.filter((execution) => execution.status === 'running').length, 1);
});

test('destination maintenance pauses only matching non-terminal history', async () => {
  const { listExecutionHistory, pauseNonTerminalExecutionHistory, upsertExecutionHistory } = await import(
    '../src/dashboard/dashboard.service.js?dashboard-destination-pause=1'
  );
  const otherOutputDir = path.join(tempRoot, 'other-output');

  upsertExecutionHistory({
    sessionId: 'matching-session',
    name: null,
    sourceDir,
    outputDir,
    outputRoot: outputDir,
    status: 'running',
    startedAt: '2026-06-01T10:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-06-01T10:02:00.000Z',
    totalItems: 6,
    imageItems: 6,
    videoItems: 0,
    completedItems: 3,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });
  upsertExecutionHistory({
    sessionId: 'other-session',
    name: null,
    sourceDir,
    outputDir: otherOutputDir,
    outputRoot: otherOutputDir,
    status: 'running',
    startedAt: '2026-06-01T11:00:00.000Z',
    finishedAt: null,
    updatedAt: '2026-06-01T11:02:00.000Z',
    totalItems: 6,
    imageItems: 6,
    videoItems: 0,
    completedItems: 2,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });

  assert.equal(pauseNonTerminalExecutionHistory({ destinationPath: outputDir }), 1);

  const executions = listExecutionHistory();
  assert.equal(executions.find((execution) => execution.sessionId === 'matching-session')?.status, 'paused');
  assert.equal(executions.find((execution) => execution.sessionId === 'other-session')?.status, 'running');
});
