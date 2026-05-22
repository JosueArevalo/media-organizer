import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-network-destinations-test-'));
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

test('saved network destinations store friendly metadata without secrets', async () => {
  const {
    deleteNetworkDestination,
    listNetworkDestinations,
    saveNetworkDestination
  } = await import('../src/pipeline/export/networkDestination.service.js');

  const saved = saveNetworkDestination({
    name: 'Synology',
    rootPath: '\\\\192.168.0.148\\Xternal',
    username: 'pepe'
  });

  assert.equal(saved.name, 'Synology');
  assert.equal(saved.rootPath, '\\\\192.168.0.148\\Xternal');
  assert.equal(saved.username, 'pepe');

  const destinations = listNetworkDestinations();
  assert.equal(destinations.length, 1);
  assert.deepEqual(Object.keys(destinations[0]).sort(), [
    'createdAt',
    'id',
    'lastUsedAt',
    'name',
    'rootPath',
    'updatedAt',
    'username'
  ]);

  const tableInfo = getDb().prepare('PRAGMA table_info(network_destinations);').all() as Array<{ name: string }>;
  const columnNames = tableInfo.map((column) => column.name);
  assert.ok(!columnNames.includes('password'));
  assert.ok(!columnNames.includes('secret'));

  assert.equal(deleteNetworkDestination(saved.id), true);
  assert.equal(listNetworkDestinations().length, 0);
});

test('browse rejects non-UNC paths before filesystem access', async () => {
  const { browseNetworkPath } = await import('../src/pipeline/export/networkDestination.service.js');

  await assert.rejects(
    browseNetworkPath({ path: 'C:\\Users\\pepe' }),
    /Use a UNC path/
  );
});

test('browse rejects relative UNC traversal before filesystem access', async () => {
  const { browseNetworkPath } = await import('../src/pipeline/export/networkDestination.service.js');

  await assert.rejects(
    browseNetworkPath({ path: '\\\\server\\share\\photos\\..\\other' }),
    /relative path segments/
  );
});

test('create folder validates that target remains under selected UNC root', async () => {
  const { createNetworkFolder } = await import('../src/pipeline/export/networkDestination.service.js');

  await assert.rejects(
    createNetworkFolder({
      parentPath: '\\\\server\\share\\other',
      rootPath: '\\\\server\\share\\photos',
      folderName: 'Pepe3'
    }),
    /must stay under/
  );
});
