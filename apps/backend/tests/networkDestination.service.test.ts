import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';
import { cleanupTrackedTestTempDirectories, createTrackedTestTempDirectory } from '../../../test-utils/tempDirectory.js';

const tempRoot = createTrackedTestTempDirectory('media-organizer-network-destinations-test-');
after(() => {
  resetDbForTests();
  cleanupTrackedTestTempDirectories();
});
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
    name: 'Studio Archive',
    rootPath: '\\\\nas.example.local\\Archive',
    username: 'media-operator'
  });

  assert.equal(saved.name, 'Studio Archive');
  assert.equal(saved.rootPath, '\\\\nas.example.local\\Archive');
  assert.equal(saved.username, 'media-operator');

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
    browseNetworkPath({ path: 'C:\\Users\\media-operator' }),
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

test('net view parser ignores the completion message from localized command output', async () => {
  const { parseNetViewShares } = await import('../src/pipeline/export/networkDestination.service.js');

  const entries = parseNetViewShares(`
\\NAS
------------------------------------------------
Backups
Photos
Se ha completado  el comando correctamente.
`, 'NAS');

  assert.deepEqual(entries.map((entry) => entry.name), ['Backups', 'Photos']);
});

test('create folder validates that target remains under selected UNC root', async () => {
  const { createNetworkFolder } = await import('../src/pipeline/export/networkDestination.service.js');

  await assert.rejects(
    createNetworkFolder({
      parentPath: '\\\\server\\share\\other',
      rootPath: '\\\\server\\share\\photos',
      folderName: 'EventExport'
    }),
    /must stay under/
  );
});

test('mounted paths normalize POSIX roots and reject relative traversal', async () => {
  const {
    isSameOrUnderNetworkRoot,
    normalizeNetworkRootPath,
    parseMountedPath
  } = await import('../src/pipeline/export/networkDestination.service.js');

  assert.equal(parseMountedPath('/Volumes/Photos/'), '/Volumes/Photos');
  assert.equal(normalizeNetworkRootPath('/mnt/photos/', 'linux'), '/mnt/photos');
  assert.equal(isSameOrUnderNetworkRoot('/Volumes/Photos', '/Volumes/Photos/2026', 'darwin'), true);
  assert.equal(isSameOrUnderNetworkRoot('/Volumes/Photos', '/Volumes/Other', 'darwin'), false);
  assert.throws(() => parseMountedPath('Volumes/Photos'), /absolute mounted folder path/);
  assert.throws(() => parseMountedPath('/Volumes/Photos/../Other'), /relative path segments/);
});

test('Unix authentication directs users to their operating system without running Windows commands', async () => {
  const { authenticateNetworkPath } = await import('../src/pipeline/export/networkDestination.service.js');

  await assert.rejects(
    authenticateNetworkPath({
      path: '/Volumes/Photos',
      credentials: { username: 'media', password: 'secret' }
    }, 'darwin'),
    /Mount this SMB share with your operating system/
  );
});

test('mounted destinations can be saved, browsed, and extended on Unix', {
  skip: process.platform === 'win32'
}, async () => {
  const mountedRoot = path.join(tempRoot, 'mounted-share');
  fs.mkdirSync(path.join(mountedRoot, 'Existing'), { recursive: true });
  const {
    browseNetworkPath,
    createNetworkFolder,
    saveNetworkDestination
  } = await import('../src/pipeline/export/networkDestination.service.js');

  const saved = saveNetworkDestination({ name: 'Mounted NAS', rootPath: mountedRoot }, process.platform);
  assert.equal(saved.rootPath, mountedRoot);
  assert.equal(saved.username, null);

  const browsed = await browseNetworkPath({ path: mountedRoot, rootPath: mountedRoot }, process.platform);
  assert.deepEqual(browsed.entries.map((entry) => entry.name), ['Existing']);
  assert.equal(browsed.parentPath, null);

  const created = await createNetworkFolder({
    parentPath: mountedRoot,
    rootPath: mountedRoot,
    folderName: 'Export'
  }, process.platform);
  assert.equal(fs.existsSync(created.path), true);
});

test('saving a disconnected mounted destination does not create it', {
  skip: process.platform === 'win32'
}, async () => {
  const missingRoot = path.join(tempRoot, 'disconnected-share');
  const { saveNetworkDestination } = await import('../src/pipeline/export/networkDestination.service.js');

  assert.throws(
    () => saveNetworkDestination({ rootPath: missingRoot }, process.platform),
    /Mounted folder is not available/
  );
  assert.equal(fs.existsSync(missingRoot), false);
});
