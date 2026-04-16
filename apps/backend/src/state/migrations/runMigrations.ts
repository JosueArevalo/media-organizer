import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

const migrationsDir = currentDir;

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

const listMigrationFiles = (): string[] => {
  const files = fs.readdirSync(migrationsDir, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
};

export const runMigrations = (): string[] => {
  ensureMigrationsTable();

  const applied = getAppliedMigrationIds();
  const files = listMigrationFiles();
  const db = getDb();
  const executed: string[] = [];

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
