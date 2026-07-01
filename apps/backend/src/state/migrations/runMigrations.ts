import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

const migrationsDir = process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR ?? currentDir;

const ensureMigrationsTable = () => {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
};

const getAppliedMigrationIds = (): Set<string> => {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM schema_migrations;').all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
};

const hasTable = (tableName: string): boolean => {
  const db = getDb();
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { '1'?: number } | undefined;

  return Boolean(row);
};

const applyLegacyJobsToSessionsMigration = (): boolean => {
  const db = getDb();

  if (!hasTable('jobs') || hasTable('sessions')) {
    return false;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN TRANSACTION;

    ALTER TABLE jobs RENAME TO sessions;
    ALTER TABLE media_items RENAME COLUMN job_id TO session_id;
    ALTER TABLE item_decisions RENAME COLUMN job_id TO session_id;
    ALTER TABLE item_stage_status RENAME COLUMN job_id TO session_id;
    ALTER TABLE job_checkpoints RENAME TO session_checkpoints;
    ALTER TABLE session_checkpoints RENAME COLUMN job_id TO session_id;

    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_media_items_session_id ON media_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_item_stage_status_session_stage ON item_stage_status(session_id, stage, status);
    CREATE INDEX IF NOT EXISTS idx_item_decisions_session_id ON item_decisions(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session_id ON session_checkpoints(session_id);

    COMMIT;
    PRAGMA foreign_keys = ON;
  `);

  db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
    '002_jobs_to_sessions.sql',
    new Date().toISOString()
  );

  return true;
};

const listMigrationFiles = (): string[] => {
  const files = fs.readdirSync(migrationsDir, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
};

export const runMigrations = (): string[] => {
  ensureMigrationsTable();

  const executed: string[] = [];

  if (applyLegacyJobsToSessionsMigration()) {
    executed.push('002_jobs_to_sessions.sql');
  }

  const applied = getAppliedMigrationIds();
  const files = listMigrationFiles();
  const db = getDb();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);

    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    executed.push(file);
  }

  return executed;
};
