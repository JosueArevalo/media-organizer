import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const backendRootDir = path.resolve(currentDir, '..', '..');

const dataDir = path.join(backendRootDir, '.data');
const dbPath = path.join(dataDir, 'media-organizer.sqlite');

let dbInstance: DatabaseSync | null = null;

export const getDb = (): DatabaseSync => {
  if (dbInstance) {
    return dbInstance;
  }

  fs.mkdirSync(dataDir, { recursive: true });

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec('PRAGMA foreign_keys = ON;');

  return dbInstance;
};

export const getDbPath = (): string => dbPath;
