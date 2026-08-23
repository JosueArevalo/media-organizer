import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';
import { cleanupTrackedTestTempDirectories, createTrackedTestTempDirectory } from '../../../test-utils/tempDirectory.js';
import { runMigrations } from '../src/state/migrations/runMigrations.js';

const tempRoot = createTrackedTestTempDirectory('media-organizer-grouping-test-');
after(() => {
  resetDbForTests();
  cleanupTrackedTestTempDirectories();
});
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

const seedCompressionSessionWithDecisions = () => {
  runMigrations();

  const db = getDb();
  const now = new Date().toISOString();
  const compressionSessionId = randomUUID();
  const firstItemId = randomUUID();
  const secondItemId = randomUUID();

  db.prepare(
    `
      INSERT INTO sessions (id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at)
      VALUES (?, 'Compression source', ?, ?, 'completed', ?, ?, ?)
    `
  ).run(compressionSessionId, sourceDir, outputDir, now, now, now);

  for (const item of [
    { id: firstItemId, sourcePath: path.join(sourceDir, 'photo-a.jpg'), relativePath: 'photo-a.jpg' },
    { id: secondItemId, sourcePath: path.join(sourceDir, 'photo-b.jpg'), relativePath: 'photo-b.jpg' }
  ]) {
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
        ) VALUES (?, ?, ?, ?, 'image', 'camera', NULL, 100, NULL, ?, ?)
      `
    ).run(item.id, compressionSessionId, item.sourcePath, item.relativePath, now, now);
  }

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
      ) VALUES (?, ?, ?, 1, 1, '2026.04 - Spring Cleanup', 0, ?)
    `
  ).run(randomUUID(), compressionSessionId, firstItemId, now);

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
      ) VALUES (?, ?, ?, 1, 1, '2026.03 - Family Event', 0, ?)
    `
  ).run(randomUUID(), compressionSessionId, secondItemId, now);

  return {
    compressionSessionId,
    firstItemId,
    secondItemId
  };
};

test('startGroupingSession creates session, manifest, and group checkpoint', async () => {
  const { startGroupingSession, getGroupingSession } = await import('../src/pipeline/grouping/groupingJob.service.js');

  const result = startGroupingSession({
    name: 'Test grouping session',
    sourceDir,
    outputDir,
    compressionSessionId: randomUUID(),
    strategy: 'date',
    autoRename: true
  });

  assert.equal(result.session.status, 'running');
  assert.equal(result.checkpoint.stage, 'group');
  assert.ok(fs.existsSync(result.outputRoot));
  assert.ok(fs.existsSync(result.manifestPath));

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as { sessionId: string; strategy: string; autoRename: boolean };
  assert.equal(manifest.sessionId, result.session.id);
  assert.equal(manifest.strategy, 'date');
  assert.equal(manifest.autoRename, true);

  const persisted = getGroupingSession(result.session.id);
  assert.ok(persisted);
  assert.equal(persisted?.session.status, 'running');
  assert.equal(persisted?.checkpoint?.stage, 'group');
  assert.ok(persisted?.checkpoint?.payloadJson?.includes('outputRoot'));
});

test('grouping progress reads source decisions and group stage statuses', async () => {
  const { compressionSessionId, firstItemId, secondItemId } = seedCompressionSessionWithDecisions();
  const { startGroupingSession, getGroupingProgress } = await import('../src/pipeline/grouping/groupingJob.service.js');

  const grouping = startGroupingSession({
    sourceDir,
    outputDir,
    compressionSessionId
  });

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO item_stage_status (id, session_id, item_id, stage, status, attempt_count, last_error, updated_at)
      VALUES (?, ?, ?, 'group', 'completed', 1, NULL, ?)
    `
  ).run(randomUUID(), grouping.session.id, firstItemId, now);

  db.prepare(
    `
      INSERT INTO item_stage_status (id, session_id, item_id, stage, status, attempt_count, last_error, updated_at)
      VALUES (?, ?, ?, 'group', 'failed', 1, 'Could not group item', ?)
    `
  ).run(randomUUID(), grouping.session.id, secondItemId, now);

  const progress = getGroupingProgress(grouping.session.id);

  assert.ok(progress);
  assert.equal(progress?.total, 2);
  assert.equal(progress?.completed, 1);
  assert.equal(progress?.failed, 1);
  assert.deepEqual(progress?.groups.map((group) => group.label).sort(), ['2026.03 - Family Event', '2026.04 - Spring Cleanup']);
  assert.equal(progress?.processedItems.length, 2);
});

test('pauseGroupingSession and resumeGroupingSession update resumable session state', async () => {
  const {
    getGroupingSession,
    pauseGroupingSession,
    resumeGroupingSession,
    startGroupingSession
  } = await import('../src/pipeline/grouping/groupingJob.service.js');
  const { listExecutionHistory, upsertExecutionHistory } = await import('../src/dashboard/dashboard.service.js?grouping-pause-history=1');
  const compressionSessionId = randomUUID();

  upsertExecutionHistory({
    sessionId: compressionSessionId,
    name: null,
    sourceDir,
    outputDir,
    outputRoot: outputDir,
    status: 'completed',
    startedAt: '2026-06-01T10:00:00.000Z',
    finishedAt: '2026-06-01T10:01:00.000Z',
    updatedAt: '2026-06-01T10:01:00.000Z',
    totalItems: 2,
    imageItems: 2,
    videoItems: 0,
    completedItems: 2,
    failedItems: 0,
    imageProfileLabel: null,
    videoPresetLabel: null,
    errorSummary: []
  });

  const grouping = startGroupingSession({
    sourceDir,
    outputDir,
    compressionSessionId
  });

  const paused = pauseGroupingSession(grouping.session.id);
  assert.equal(paused?.session.status, 'paused');
  assert.equal(listExecutionHistory().find((execution) => execution.sessionId === compressionSessionId)?.groupingStatus, 'paused');

  const resumed = resumeGroupingSession(grouping.session.id);
  assert.equal(resumed?.session.status, 'running');
  assert.equal(listExecutionHistory().find((execution) => execution.sessionId === compressionSessionId)?.groupingStatus, 'running');

  const persisted = getGroupingSession(grouping.session.id);
  assert.equal(persisted?.session.status, 'running');
  assert.equal(persisted?.checkpoint?.stage, 'group');
});
