import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';
import { runMigrations } from '../src/state/migrations/runMigrations.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-grouping-workspace-test-'));
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
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
});

afterEach(() => {
  resetDbForTests();
});

const seedCompressionSession = (relativePaths: string[]) => {
  runMigrations();

  const db = getDb();
  const now = new Date().toISOString();
  const compressionSessionId = randomUUID();

  db.prepare(
    `
      INSERT INTO sessions (id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at)
      VALUES (?, 'Compression source', ?, ?, 'completed', ?, ?, ?)
    `
  ).run(compressionSessionId, sourceDir, outputDir, now, now, now);

  const items = relativePaths.map((relativePath) => {
    const itemId = randomUUID();
    const sourcePath = path.join(sourceDir, relativePath);
    const outputPath = path.join(outputDir, relativePath);

    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(sourcePath, `source ${relativePath}`);
    fs.writeFileSync(outputPath, `output ${relativePath}`);

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
    ).run(itemId, compressionSessionId, sourcePath, relativePath, now, now);

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
        ) VALUES (?, ?, ?, 1, 1, NULL, 0, ?)
      `
    ).run(randomUUID(), compressionSessionId, itemId, now);

    return { itemId, relativePath, outputPath };
  });

  return { compressionSessionId, items };
};

test('createGroupingWorkspace proposes event folders from filenames and misc folders for single dates', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'IMG_20250102_101010.jpg',
    'IMG_20250102_101111.jpg',
    'IMG_20240203_101010.jpg'
  ]);
  const { createGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({
    sourceDir,
    outputDir,
    compressionSessionId
  });

  assert.deepEqual(
    workspace.folders.map((folder) => folder.label).sort(),
    ['2024 - Varias 2024', '2025.01.02 - Evento']
  );
  assert.equal(workspace.items.filter((item) => item.targetGroupLabel === '2025.01.02 - Evento').length, 2);
});

test('folders can be created, renamed, assigned, deleted when empty, and applied with collision-safe moves', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['album-a/photo.jpg', 'album-b/photo.jpg']);
  const {
    applyGroupingWorkspace,
    assignGroupingItems,
    createGroupingFolder,
    createGroupingWorkspace,
    deleteGroupingFolder,
    getGroupingWorkspace,
    renameGroupingFolder
  } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const manualFolder = createGroupingFolder(workspace.sessionId, 'BBQ');
  const emptyFolder = createGroupingFolder(workspace.sessionId, 'Empty');
  const renamed = renameGroupingFolder(workspace.sessionId, manualFolder.id, 'Party');

  assert.equal(renamed?.label, 'Party');
  assert.equal(deleteGroupingFolder(workspace.sessionId, emptyFolder.id), true);

  const assigned = assignGroupingItems(
    workspace.sessionId,
    items.map((item) => item.itemId),
    'Party'
  );

  assert.equal(assigned?.items.filter((item) => item.targetGroupLabel === 'Party').length, 2);

  const result = applyGroupingWorkspace(workspace.sessionId);
  assert.equal(result?.status, 'completed');
  assert.equal(result?.movedItems, 2);
  assert.ok(fs.existsSync(path.join(outputDir, 'Party', 'photo.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, 'Party', 'photo (2).jpg')));

  const afterApply = getGroupingWorkspace(workspace.sessionId);
  assert.equal(afterApply?.folders.find((folder) => folder.label === 'Party')?.itemCount, 2);
  assert.ok(afterApply?.items.every((item) => item.relativePath.startsWith(`Party${path.sep}`)));
});

test('applyGroupingWorkspace refuses paths outside the destination folder', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['inside.jpg']);
  const db = getDb();
  const { applyGroupingWorkspace, createGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  db.prepare('UPDATE media_items SET relative_path = ? WHERE id = ?').run(path.join('..', 'outside.jpg'), items[0].itemId);

  assert.throws(() => applyGroupingWorkspace(workspace.sessionId), /outside the destination folder/);
});

test('grouping folder templates can be created, updated, used, and deleted', async () => {
  const { compressionSessionId } = seedCompressionSession(['IMG_20250102_101010.jpg']);
  const {
    createFolderFromTemplate,
    createGroupingTemplate,
    createGroupingWorkspace,
    deleteGroupingTemplate,
    listGroupingTemplates,
    updateGroupingTemplate
  } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  let templates = createGroupingTemplate({ name: 'Family', pattern: 'Fotos Familia', enabled: true });

  assert.equal(templates.length, 1);
  assert.equal(templates[0].name, 'Family');

  templates = updateGroupingTemplate(templates[0].id, { pattern: '{year} - Varias {year}', enabled: true }) ?? [];
  const folder = createFolderFromTemplate(workspace.sessionId, templates[0].id);

  assert.match(folder?.label ?? '', /^\d{4} - Varias \d{4}$/);
  assert.equal(deleteGroupingTemplate(templates[0].id), true);
  assert.equal(listGroupingTemplates().length, 0);
});
