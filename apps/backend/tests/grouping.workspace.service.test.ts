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

test('createGroupingWorkspace opens without automatic proposals', async () => {
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
    []
  );
  assert.equal(workspace.items.every((item) => item.targetGroupLabel === null), true);
});

test('reorganizeGroupingWorkspace proposes enabled date rules only', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'IMG_20250102_101010.jpg',
    'IMG_20250102_101111.jpg',
    'IMG_20240203_101010.jpg',
    'notes/no-date.jpg'
  ]);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({
    sourceDir,
    outputDir,
    compressionSessionId
  });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple', 'single-date-year-unique'],
    preservedDirectories: [],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.deepEqual(
    proposed.folders.map((folder) => folder.label).sort(),
    ['2024 - Unique', '2025.01.02 - Evento']
  );
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.02 - Evento').length, 2);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2024 - Unique').length, 1);
  assert.ok(proposed.items.find((item) => item.relativePath === 'notes/no-date.jpg')?.targetGroupLabel === null);
});

test('reorganizeGroupingWorkspace does not generate proposals when no rules are active', async () => {
  const { compressionSessionId } = seedCompressionSession(['IMG_20250102_101010.jpg', 'IMG_20250102_101111.jpg']);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: [],
    preservedDirectories: [],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.deepEqual(proposed.folders, []);
  assert.equal(proposed.items.every((item) => item.targetGroupLabel === null), true);
});

test('reorganizeGroupingWorkspace keeps marked directories out of date reorganization', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'Camera A/DCIM/IMG_20250102_101010.jpg',
    'Camera B/DCIM/IMG_20250102_101111.jpg',
    'Long Event/day-1/IMG_20250102_111111.jpg',
    'Long Event/day-2/IMG_20250103_111111.jpg'
  ]);
  const { applyGroupingWorkspace, createGroupingWorkspace, getGroupingWorkspace, reorganizeGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );

  const workspace = createGroupingWorkspace({
    sourceDir,
    outputDir,
    compressionSessionId
  });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple', 'single-date-year-unique'],
    preservedDirectories: ['source/Long Event'],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.deepEqual(proposed.folders.map((folder) => folder.label), ['2025.01.02 - Evento']);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.02 - Evento').length, 2);
  assert.equal(proposed.items.filter((item) => item.preservedStructure).length, 2);
  assert.ok(proposed.items.filter((item) => item.preservedStructure).every((item) => item.targetGroupLabel === null));

  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.status, 'completed');
  assert.equal(result?.movedItems, 2);
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.02 - Evento', 'IMG_20250102_101010.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.02 - Evento', 'IMG_20250102_101111.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, 'Long Event', 'day-1', 'IMG_20250102_111111.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, 'Long Event', 'day-2', 'IMG_20250103_111111.jpg')));

  const afterApply = getGroupingWorkspace(workspace.sessionId);
  assert.equal(afterApply?.items.filter((item) => item.preservedStructure).length, 2);
});

test('preserved directories match relative paths when source paths are not under source root', async () => {
  const { compressionSessionId, items } = seedCompressionSession([
    'Event Folder/IMG_20250102_111111.jpg',
    'Other Folder/IMG_20250102_121111.jpg'
  ]);
  const db = getDb();
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  db.prepare('UPDATE media_items SET source_path = ? WHERE id = ?').run(
    path.join(outputDir, 'Event Folder', 'IMG_20250102_111111.jpg'),
    items[0].itemId
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple'],
    preservedDirectories: ['source/Event Folder'],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.equal(proposed.items.find((item) => item.relativePath === 'Event Folder/IMG_20250102_111111.jpg')?.preservedStructure, true);
  assert.equal(proposed.items.find((item) => item.relativePath === 'Event Folder/IMG_20250102_111111.jpg')?.targetGroupLabel, null);
  assert.equal(proposed.items.find((item) => item.relativePath === 'Other Folder/IMG_20250102_121111.jpg')?.targetGroupLabel, null);
});

test('preserved directories use the source root folder name sent by the UI', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'Event Folder/IMG_20250102_111111.jpg',
    'Other Folder/IMG_20250102_121111.jpg',
    'Other Folder/IMG_20250102_131111.jpg'
  ]);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple'],
    preservedDirectories: [`${path.basename(sourceDir)}/Event Folder`],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.equal(proposed.items.find((item) => item.relativePath === 'Event Folder/IMG_20250102_111111.jpg')?.preservedStructure, true);
  assert.equal(proposed.items.find((item) => item.relativePath === 'Event Folder/IMG_20250102_111111.jpg')?.targetGroupLabel, null);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.02 - Evento').length, 2);
});

test('reorganized child directories override a preserved parent directory', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'Album/keep/IMG_20250102_111111.jpg',
    'Album/reorganize/IMG_20250103_111111.jpg',
    'Album/reorganize/IMG_20250103_121111.jpg'
  ]);
  const { applyGroupingWorkspace, createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({
    sourceDir,
    outputDir,
    compressionSessionId
  });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple'],
    preservedDirectories: ['source/Album'],
    reorganizedDirectories: ['source/Album/reorganize']
  });

  assert.ok(proposed);
  assert.deepEqual(proposed.folders.map((folder) => folder.label), ['2025.01.03 - Evento']);
  assert.equal(proposed.items.filter((item) => item.preservedStructure).length, 1);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.03 - Evento').length, 2);

  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.movedItems, 2);
  assert.ok(fs.existsSync(path.join(outputDir, 'Album', 'keep', 'IMG_20250102_111111.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.03 - Evento', 'IMG_20250103_111111.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.03 - Evento', 'IMG_20250103_121111.jpg')));
});

test('manual assignments can move media from preserved directories', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['Album/IMG_20250102_111111.jpg']);
  const { applyGroupingWorkspace, assignGroupingItems, createGroupingWorkspace, reorganizeGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple', 'single-date-year-unique'],
    preservedDirectories: ['source/Album'],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.equal(proposed.items[0].preservedStructure, true);
  assert.equal(proposed.items[0].targetGroupLabel, null);

  assignGroupingItems(workspace.sessionId, [items[0].itemId], 'Manual');
  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.movedItems, 1);
  assert.ok(fs.existsSync(path.join(outputDir, 'Manual', 'IMG_20250102_111111.jpg')));
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

test('deleteGroupingItems hides selected items and apply removes only destination copies', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['keep.jpg', 'delete.jpg']);
  const db = getDb();
  const { applyGroupingWorkspace, createGroupingWorkspace, deleteGroupingItems, getGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const deletedItem = items.find((item) => item.relativePath === 'delete.jpg');
  const keptItem = items.find((item) => item.relativePath === 'keep.jpg');

  assert.ok(deletedItem);
  assert.ok(keptItem);

  const afterDelete = deleteGroupingItems(workspace.sessionId, [deletedItem.itemId]);

  assert.equal(afterDelete?.items.some((item) => item.id === deletedItem.itemId), false);

  const decision = db
    .prepare('SELECT selected_for_output FROM item_decisions WHERE session_id = ? AND item_id = ?')
    .get(compressionSessionId, deletedItem.itemId) as { selected_for_output: number };

  assert.equal(decision.selected_for_output, 0);

  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.status, 'completed');
  assert.equal(result?.deletedItems, 1);
  assert.equal(fs.existsSync(path.join(outputDir, 'delete.jpg')), false);
  assert.equal(fs.existsSync(path.join(sourceDir, 'delete.jpg')), true);
  assert.equal(fs.existsSync(path.join(sourceDir, 'keep.jpg')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'keep.jpg')), true);

  const afterApply = getGroupingWorkspace(workspace.sessionId);
  assert.equal(afterApply?.items.some((item) => item.id === deletedItem.itemId), false);
  assert.equal(afterApply?.items.some((item) => item.id === keptItem.itemId), true);
});

test('applyGroupingWorkspace refuses paths outside the destination folder', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['inside.jpg']);
  const db = getDb();
  const { applyGroupingWorkspace, createGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  db.prepare('UPDATE media_items SET relative_path = ? WHERE id = ?').run(path.join('..', 'outside.jpg'), items[0].itemId);

  assert.throws(() => applyGroupingWorkspace(workspace.sessionId), /outside the destination folder/);
});

test('applyGroupingWorkspace refuses to delete excluded items outside the destination folder', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['inside.jpg']);
  const db = getDb();
  const { applyGroupingWorkspace, createGroupingWorkspace, deleteGroupingItems } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  deleteGroupingItems(workspace.sessionId, [items[0].itemId]);
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
