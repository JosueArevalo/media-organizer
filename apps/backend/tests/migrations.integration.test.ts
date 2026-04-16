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

beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  resetDbForTests();
});

afterEach(() => {
  resetDbForTests();
});

test('initial migration creates core state tables', async () => {
  const { runMigrations } = await import('../src/state/migrations/runMigrations.js?integration=1');

  const executed = runMigrations();
  assert.deepEqual(executed, ['001_initial_state.sql']);

  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all() as Array<{ name: string }>;
  const tableNames = tables.map((row) => row.name);

  assert.ok(tableNames.includes('jobs'));
  assert.ok(tableNames.includes('media_items'));
  assert.ok(tableNames.includes('item_decisions'));
  assert.ok(tableNames.includes('item_stage_status'));
  assert.ok(tableNames.includes('job_checkpoints'));
  assert.ok(tableNames.includes('schema_migrations'));

  const migrationRows = db.prepare('SELECT id FROM schema_migrations;').all() as Array<{ id: string }>;
  assert.deepEqual(migrationRows.map((row) => row.id), ['001_initial_state.sql']);
});
