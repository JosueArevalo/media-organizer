import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const backendRootDir = path.resolve(currentDir, '..', '..');

let dbInstance: DatabaseSync | null = null;
let dbInstancePath: string | null = null;

const getDataDir = (): string => process.env.MEDIA_ORGANIZER_DATA_DIR ?? path.join(backendRootDir, '.data');

const getDbPathFromEnv = (): string => {
  const dataDir = getDataDir();
  return process.env.MEDIA_ORGANIZER_DB_PATH ?? path.join(dataDir, 'media-organizer.sqlite');
};

export const getDb = (): DatabaseSync => {
  const dbPath = getDbPathFromEnv();

  if (dbInstance && dbInstancePath !== dbPath) {
    dbInstance.close();
    dbInstance = null;
    dbInstancePath = null;
  }

  if (dbInstance) {
    return dbInstance;
  }

  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  dbInstance = new DatabaseSync(dbPath);
  dbInstancePath = dbPath;
  dbInstance.exec('PRAGMA foreign_keys = ON;');

  return dbInstance;
};

export const getDbPath = (): string => getDbPathFromEnv();

export const resetDbForTests = (): void => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbInstancePath = null;
  }
};
