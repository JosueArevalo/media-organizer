import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach, afterEach } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-backend-test-'));
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
});

afterEach(() => {
  resetDbForTests();
});

test('initial migration creates core state tables', async () => {
  const { runMigrations } = await import('../src/state/migrations/runMigrations.js?integration=1');

  const executed = runMigrations();
  assert.deepEqual(executed, [
    '001_initial_state.sql',
    '003_grouping_stage.sql',
    '004_grouping_workspace.sql',
    '005_execution_history.sql',
    '006_export_jobs.sql',
    '007_network_destinations.sql',
    '008_execution_verification.sql'
  ]);

  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all() as Array<{ name: string }>;
  const tableNames = tables.map((row) => row.name);

  assert.ok(tableNames.includes('sessions'));
  assert.ok(tableNames.includes('media_items'));
  assert.ok(tableNames.includes('item_decisions'));
  assert.ok(tableNames.includes('item_stage_status'));
  assert.ok(tableNames.includes('session_checkpoints'));
  assert.ok(tableNames.includes('grouping_folders'));
  assert.ok(tableNames.includes('grouping_folder_templates'));
  assert.ok(tableNames.includes('execution_history'));
  assert.ok(tableNames.includes('export_jobs'));
  assert.ok(tableNames.includes('export_items'));
  assert.ok(tableNames.includes('export_checkpoints'));
  assert.ok(tableNames.includes('network_destinations'));
  assert.ok(tableNames.includes('schema_migrations'));

  const migrationRows = db.prepare('SELECT id FROM schema_migrations;').all() as Array<{ id: string }>;
  assert.deepEqual(migrationRows.map((row) => row.id), [
    '001_initial_state.sql',
    '003_grouping_stage.sql',
    '004_grouping_workspace.sql',
    '005_execution_history.sql',
    '006_export_jobs.sql',
    '007_network_destinations.sql',
    '008_execution_verification.sql'
  ]);
});

test('legacy jobs schema upgrades to sessions without data loss', async () => {
  const db = getDb();

  db.exec(`
    CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    INSERT INTO schema_migrations (id, applied_at) VALUES ('001_initial_state.sql', '2026-01-01T00:00:00.000Z');

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      name TEXT,
      source_dir TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_opened_at TEXT
    );

    CREATE TABLE media_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      source_kind_detected TEXT NOT NULL,
      source_kind_override TEXT,
      size_bytes INTEGER NOT NULL,
      capture_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE item_decisions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      selected_for_compression INTEGER NOT NULL,
      selected_for_output INTEGER NOT NULL,
      target_group_label TEXT,
      user_overridden INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE item_stage_status (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE job_checkpoints (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      cursor TEXT,
      payload_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  db.prepare(
    `
      INSERT INTO jobs (id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('job-1', 'Legacy job', sourceDir, outputDir, 'running', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', null);

  db.prepare(
    `
      INSERT INTO media_items (id, job_id, source_path, relative_path, media_type, source_kind_detected, source_kind_override, size_bytes, capture_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('item-1', 'job-1', path.join(sourceDir, 'photo.jpg'), 'photo.jpg', 'image', 'camera', null, 123, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

  db.prepare(
    `
      INSERT INTO item_decisions (id, job_id, item_id, selected_for_compression, selected_for_output, target_group_label, user_overridden, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('decision-1', 'job-1', 'item-1', 1, 1, null, 0, '2026-01-01T00:00:00.000Z');

  db.prepare(
    `
      INSERT INTO item_stage_status (id, job_id, item_id, stage, status, attempt_count, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run('stage-1', 'job-1', 'item-1', 'compress', 'running', 0, null, '2026-01-01T00:00:00.000Z');

  db.prepare(
    `
      INSERT INTO job_checkpoints (id, job_id, stage, cursor, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run('checkpoint-1', 'job-1', 'compress', null, '{"outputRoot":"legacy"}', '2026-01-01T00:00:00.000Z');

  const { runMigrations } = await import('../src/state/migrations/runMigrations.js?integration=legacy');

  const executed = runMigrations();

  assert.deepEqual(executed, [
    '002_jobs_to_sessions.sql',
    '003_grouping_stage.sql',
    '004_grouping_workspace.sql',
    '005_execution_history.sql',
    '006_export_jobs.sql',
    '007_network_destinations.sql',
    '008_execution_verification.sql'
  ]);

  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    .all() as Array<{ name: string }>;

  assert.ok(tableNames.map((row) => row.name).includes('sessions'));
  assert.ok(!tableNames.map((row) => row.name).includes('jobs'));

  const sessions = db.prepare('SELECT id, name, source_dir, output_dir, status FROM sessions WHERE id = ?').all('job-1') as Array<{
    id: string;
    name: string | null;
    source_dir: string;
    output_dir: string;
    status: string;
  }>;

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].name, 'Legacy job');
  assert.equal(sessions[0].status, 'running');

  const mediaItems = db.prepare('SELECT session_id, source_path FROM media_items WHERE id = ?').all('item-1') as Array<{
    session_id: string;
    source_path: string;
  }>;

  assert.equal(mediaItems.length, 1);
  assert.equal(mediaItems[0].session_id, 'job-1');

  const checkpoints = db.prepare('SELECT session_id, stage, payload_json FROM session_checkpoints WHERE id = ?').all('checkpoint-1') as Array<{
    session_id: string;
    stage: string;
    payload_json: string | null;
  }>;

  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].session_id, 'job-1');
  assert.equal(checkpoints[0].stage, 'compress');

  const migrationRows = db.prepare('SELECT id FROM schema_migrations ORDER BY id;').all() as Array<{ id: string }>;
  assert.deepEqual(migrationRows.map((row) => row.id), [
    '001_initial_state.sql',
    '002_jobs_to_sessions.sql',
    '003_grouping_stage.sql',
    '004_grouping_workspace.sql',
    '005_execution_history.sql',
    '006_export_jobs.sql',
    '007_network_destinations.sql',
    '008_execution_verification.sql'
  ]);
});
