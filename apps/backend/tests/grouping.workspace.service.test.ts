import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import sharp from 'sharp';
import { getDb, resetDbForTests } from '../src/state/db.js';
import { runMigrations } from '../src/state/migrations/runMigrations.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-grouping-workspace-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');
const sourceDir = path.join(tempRoot, 'source');
const outputDir = path.join(tempRoot, 'output');

const writeTestImage = async (filePath: string, format: 'jpeg' | 'png' | 'webp' | 'gif' = 'jpeg', orientation?: number) => {
  let image = sharp({
    create: {
      width: 720,
      height: 480,
      channels: 3,
      background: { r: 32, g: 96, b: 160 }
    }
  });

  if (orientation) {
    image = image.withMetadata({ orientation });
  }

  await image.toFormat(format).toFile(filePath);
};

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
    const extension = path.extname(relativePath).toLowerCase();
    const mediaType = ['.mp4', '.mov', '.m4v', '.avi', '.mkv'].includes(extension) ? 'video' : 'image';

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
        ) VALUES (?, ?, ?, ?, ?, 'camera', NULL, 100, NULL, ?, ?)
      `
    ).run(itemId, compressionSessionId, sourcePath, relativePath, mediaType, now, now);

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

    db.prepare(
      `
        INSERT INTO item_stage_status (
          id,
          session_id,
          item_id,
          stage,
          status,
          attempt_count,
          last_error,
          updated_at
        ) VALUES (?, ?, ?, 'compress', 'completed', 1, NULL, ?)
      `
    ).run(randomUUID(), compressionSessionId, itemId, now);

    return { itemId, relativePath, outputPath };
  });

  return { compressionSessionId, items };
};

const seedCompressionManifest = (
  compressionSessionId: string,
  imageMagickCommand: string,
  processingPolicy?: { heic: 'convert' | 'copy' }
) => {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO session_checkpoints (id, session_id, stage, cursor, payload_json, updated_at)
      VALUES (?, ?, 'compress', NULL, ?, ?)
      ON CONFLICT(session_id, stage) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `
  ).run(
    randomUUID(),
    compressionSessionId,
    JSON.stringify({
      outputRoot: outputDir,
      manifest: {
        imageMagickCommand,
        processingPolicy
      }
    }),
    now
  );
};

const writeFakeMagick = (toolsDir: string, supportsHeic: boolean) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `magick-fake-${supportsHeic ? 'heic' : 'missing'}${extension}`);
  const script = process.platform === 'win32'
    ? `@echo off
if "%~1"=="identify" (
  ${supportsHeic ? 'echo HEIC RW' : 'echo JPEG RW'}
  exit /b 0
)
set "last="
for %%A in (%*) do set "last=%%~A"
echo preview > "%last%"
exit /b 0
`
    : `#!/usr/bin/env sh
if [ "$1" = "identify" ]; then
  ${supportsHeic ? 'echo "HEIC RW"' : 'echo "JPEG RW"'}
  exit 0
fi
last=""
for arg in "$@"; do
  last="$arg"
done
printf 'preview\\n' > "$last"
`;

  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

const writeSlowFakeMagick = (toolsDir: string) => {
  const filePath = writeFakeMagick(toolsDir, true);
  const source = fs.readFileSync(filePath, 'utf8');
  const delayed = process.platform === 'win32'
    ? source.replace('set "last="', 'ping 127.0.0.1 -n 2 >nul\nset "last="')
    : source.replace('last=""', 'sleep 0.5\nlast=""');
  fs.writeFileSync(filePath, delayed, 'utf8');
  return filePath;
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

test('createGroupingWorkspace excludes media that failed compression', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['ready.jpg', 'failed.jpg']);
  const failedItem = items.find((item) => item.relativePath === 'failed.jpg');
  assert.ok(failedItem);

  getDb()
    .prepare(
      `
        UPDATE item_stage_status
        SET status = 'failed',
            last_error = 'Unusable input image.'
        WHERE session_id = ?
          AND item_id = ?
          AND stage = 'compress'
      `
    )
    .run(compressionSessionId, failedItem.itemId);

  const { createGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js?exclude-failed-compression=1');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  assert.deepEqual(workspace.items.map((item) => item.relativePath), ['ready.jpg']);
});

test('getGroupingPreviewPath serves web-safe images without conversion', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.webp']);
  const { createGroupingWorkspace, getGroupingPreviewPath } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  const preview = await getGroupingPreviewPath(workspace.sessionId, items[0].itemId);

  assert.ok(preview);
  assert.equal(preview.path, path.join(outputDir, 'photo.webp'));
  assert.equal(preview.mediaType, 'image');
});

test('getGroupingThumbnailPath generates and reuses web-safe thumbnails without ImageMagick', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.jpg']);
  await writeTestImage(items[0].outputPath);

  const { createGroupingWorkspace, getGroupingThumbnailPath } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  const thumbnail = await getGroupingThumbnailPath(workspace.sessionId, items[0].itemId);

  assert.ok(thumbnail);
  assert.equal(thumbnail.path.endsWith('-thumb.jpg'), true);
  assert.equal(thumbnail.mediaType, 'image');
  const metadata = await sharp(thumbnail.path).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.ok((metadata.width ?? 0) <= 360);
  assert.ok((metadata.height ?? 0) <= 360);

  const cachedMtime = fs.statSync(thumbnail.path).mtimeMs;
  const cachedThumbnail = await getGroupingThumbnailPath(workspace.sessionId, items[0].itemId);

  assert.equal(cachedThumbnail?.path, thumbnail.path);
  assert.equal(fs.statSync(thumbnail.path).mtimeMs, cachedMtime);
});

test('getGroupingThumbnailPath regenerates stale thumbnails', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.jpg']);
  await writeTestImage(items[0].outputPath);

  const { createGroupingWorkspace, getGroupingThumbnailPath } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  const thumbnail = await getGroupingThumbnailPath(workspace.sessionId, items[0].itemId);
  assert.ok(thumbnail);

  const initialMtime = fs.statSync(thumbnail.path).mtimeMs;
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(items[0].outputPath, future, future);

  const regeneratedThumbnail = await getGroupingThumbnailPath(workspace.sessionId, items[0].itemId);

  assert.equal(regeneratedThumbnail?.path, thumbnail.path);
  assert.ok(fs.statSync(thumbnail.path).mtimeMs >= initialMtime);
});

test('getGroupingThumbnailPath reports corrupt images without leaving temporary files', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['corrupt.jpg']);
  fs.writeFileSync(items[0].outputPath, 'not an image');
  const { createGroupingWorkspace, getGroupingThumbnailPath, GroupingPreviewError } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  await assert.rejects(
    getGroupingThumbnailPath(workspace.sessionId, items[0].itemId),
    (error) => error instanceof GroupingPreviewError && /thumbnail/.test(error.message)
  );
  const previewDir = path.join(outputDir, '.media-organizer', 'previews', workspace.sessionId);
  assert.deepEqual(fs.existsSync(previewDir) ? fs.readdirSync(previewDir).filter((name) => name.includes('.tmp.')) : [], []);
});

test('getGroupingThumbnailPath supports web formats, EXIF rotation and concurrent requests', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.jpg', 'photo.png', 'photo.webp', 'photo.gif']);
  await Promise.all([
    writeTestImage(items[0].outputPath, 'jpeg', 6),
    writeTestImage(items[1].outputPath, 'png'),
    writeTestImage(items[2].outputPath, 'webp'),
    writeTestImage(items[3].outputPath, 'gif')
  ]);

  const { createGroupingWorkspace, getGroupingThumbnailPath } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const [first, duplicate, png, webp, gif] = await Promise.all([
    getGroupingThumbnailPath(workspace.sessionId, items[0].itemId),
    getGroupingThumbnailPath(workspace.sessionId, items[0].itemId),
    getGroupingThumbnailPath(workspace.sessionId, items[1].itemId),
    getGroupingThumbnailPath(workspace.sessionId, items[2].itemId),
    getGroupingThumbnailPath(workspace.sessionId, items[3].itemId)
  ]);

  assert.equal(first?.path, duplicate?.path);
  assert.ok(first && png && webp && gif);
  const rotatedMetadata = await sharp(first.path).metadata();
  assert.ok((rotatedMetadata.height ?? 0) > (rotatedMetadata.width ?? 0));
  assert.ok([first.path, png.path, webp.path, gif.path].every((filePath) => fs.existsSync(filePath)));
  assert.deepEqual(
    fs.readdirSync(path.dirname(first.path)).filter((fileName) => fileName.includes('.tmp.')),
    []
  );
});

test('getGroupingPreviewPath generates and reuses HEIC previews with ImageMagick', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.heic']);
  const toolsDir = path.join(tempRoot, 'tools-heic-preview');
  const fakeMagick = writeFakeMagick(toolsDir, true);
  seedCompressionManifest(compressionSessionId, fakeMagick);

  const { createGroupingWorkspace, getGroupingPreviewPath } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  const preview = await getGroupingPreviewPath(workspace.sessionId, items[0].itemId);

  assert.ok(preview);
  assert.equal(preview.path.endsWith('.jpg'), true);
  assert.equal(preview.mediaType, 'image');
  assert.equal(fs.readFileSync(preview.path, 'utf8').trim(), 'preview');

  fs.writeFileSync(preview.path, 'cached\n', 'utf8');
  const cachedPreview = await getGroupingPreviewPath(workspace.sessionId, items[0].itemId);

  assert.equal(cachedPreview?.path, preview.path);
  assert.equal(fs.readFileSync(preview.path, 'utf8').trim(), 'cached');
});

test('health remains responsive while an ImageMagick preview is running', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['slow.heic']);
  const fakeMagick = writeSlowFakeMagick(path.join(tempRoot, 'tools-slow-preview'));
  seedCompressionManifest(compressionSessionId, fakeMagick);
  const { createGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const { createBackendServer } = await import('../src/index.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const server = createBackendServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const previewPromise = fetch(`${base}/api/grouping/${workspace.sessionId}/items/${items[0].itemId}/preview`, {
      headers: { Origin: 'http://localhost:5173' }
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const startedAt = Date.now();
    const health = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(health.status, 200);
    assert.ok(Date.now() - startedAt < 400);
    assert.equal((await previewPromise).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('getGroupingThumbnailPath reports ImageMagick errors', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.heic']);
  const toolsDir = path.join(tempRoot, 'tools-thumbnail-missing');
  const fakeMagick = writeFakeMagick(toolsDir, false);
  seedCompressionManifest(compressionSessionId, fakeMagick);

  const { createGroupingWorkspace, getGroupingThumbnailPath, GroupingPreviewError } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  await assert.rejects(
    getGroupingThumbnailPath(workspace.sessionId, items[0].itemId),
    (error) => error instanceof GroupingPreviewError && /HEIC\/HEIF support/.test(error.message)
  );
});

test('copied HEIC reports unavailable preview without resolving an implicit ImageMagick command', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.heic']);
  seedCompressionManifest(compressionSessionId, '', { heic: 'copy' });

  const { createGroupingWorkspace, getGroupingThumbnailPath, GroupingPreviewError } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  await assert.rejects(
    getGroupingThumbnailPath(workspace.sessionId, items[0].itemId),
    (error) => error instanceof GroupingPreviewError && /copied without ImageMagick/.test(error.message)
  );
});

test('getGroupingThumbnailPath rejects media paths outside the destination folder', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['inside.jpg']);
  const db = getDb();

  db.prepare('UPDATE media_items SET relative_path = ? WHERE id = ?').run(path.join('..', 'outside.jpg'), items[0].itemId);

  const { createGroupingWorkspace, getGroupingThumbnailPath } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  await assert.rejects(
    getGroupingThumbnailPath(workspace.sessionId, items[0].itemId),
    /Refusing to read media outside the destination folder/
  );
});

test('getGroupingPreviewPath reports HEIC support errors from ImageMagick', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['photo.heic']);
  const toolsDir = path.join(tempRoot, 'tools-heic-preview-missing');
  const fakeMagick = writeFakeMagick(toolsDir, false);
  seedCompressionManifest(compressionSessionId, fakeMagick);

  const { createGroupingWorkspace, getGroupingPreviewPath, GroupingPreviewError } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );
  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });

  await assert.rejects(
    getGroupingPreviewPath(workspace.sessionId, items[0].itemId),
    (error) => error instanceof GroupingPreviewError && /HEIC\/HEIF support/.test(error.message)
  );
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
    ['2024 - Unique', '2025.01.02 - Event']
  );
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.02 - Event').length, 2);
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

test('date strategy creates daily Event folders for single-media dates when requested', async () => {
  const { compressionSessionId } = seedCompressionSession(['IMG_20250102_101010.jpg']);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    strategy: 'date',
    dateOptions: { singleDateHandling: 'daily-event' },
    preservedDirectories: [],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.deepEqual(proposed.folders.map((folder) => folder.label), ['2025.01.02 - Event']);
  assert.equal(proposed.items[0].targetGroupLabel, '2025.01.02 - Event');
});

test('date strategy keeps single-media dates in their original structure when requested', async () => {
  const { compressionSessionId } = seedCompressionSession(['IMG_20250102_101010.jpg']);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    strategy: 'date',
    dateOptions: { singleDateHandling: 'keep-original' },
    preservedDirectories: [],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.deepEqual(proposed.folders, []);
  assert.equal(proposed.items[0].targetGroupLabel, null);
});

test('source folder strategy groups media from the nearest source folder', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'Album/Day 1/IMG_20250102_101010.jpg',
    'Album/Day 1/IMG_20250103_101010.jpg',
    'Album/Day 2/IMG_20250104_101010.jpg'
  ]);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    strategy: 'source-folder',
    sourceFolderOptions: { mode: 'nearest-folder' },
    preservedDirectories: [],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.deepEqual(proposed.folders.map((folder) => folder.label).sort(), ['Day 1', 'Day 2']);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === 'Day 1').length, 2);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === 'Day 2').length, 1);
});

test('source folder strategy can include the readable relative folder path', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'Album/Day 1/IMG_20250102_101010.jpg',
    'Album/Day 1/IMG_20250103_101010.jpg',
    'Album/Day 2/IMG_20250104_101010.jpg'
  ]);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    strategy: 'source-folder',
    sourceFolderOptions: { mode: 'relative-path' },
    preservedDirectories: [],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.deepEqual(proposed.folders.map((folder) => folder.label).sort(), ['Album - Day 1', 'Album - Day 2']);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === 'Album - Day 1').length, 2);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === 'Album - Day 2').length, 1);
});

test('source folder strategy defaults new proposals to the readable relative path', async () => {
  const { compressionSessionId } = seedCompressionSession([
    'Mobile/DCIM/IMG_20250102_101010.jpg',
    'Camera/DCIM/IMG_20250103_101010.jpg'
  ]);
  const { createGroupingWorkspace, reorganizeGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    strategy: 'source-folder',
    preservedDirectories: [],
    reorganizedDirectories: []
  });

  assert.ok(proposed);
  assert.equal(proposed.sourceFolderOptions.mode, 'relative-path');
  assert.deepEqual(proposed.folders.map((folder) => folder.label).sort(), ['Camera - DCIM', 'Mobile - DCIM']);
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
  assert.deepEqual(proposed.folders.map((folder) => folder.label), ['2025.01.02 - Event']);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.02 - Event').length, 2);
  assert.equal(proposed.items.filter((item) => item.preservedStructure).length, 2);
  assert.ok(proposed.items.filter((item) => item.preservedStructure).every((item) => item.targetGroupLabel === null));

  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.status, 'completed');
  assert.equal(result?.movedItems, 2);
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.02 - Event', 'IMG_20250102_101010.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.02 - Event', 'IMG_20250102_101111.jpg')));
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
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.02 - Event').length, 2);
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
  assert.deepEqual(proposed.folders.map((folder) => folder.label), ['2025.01.03 - Event']);
  assert.equal(proposed.items.filter((item) => item.preservedStructure).length, 1);
  assert.equal(proposed.items.filter((item) => item.targetGroupLabel === '2025.01.03 - Event').length, 2);

  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.movedItems, 2);
  assert.ok(fs.existsSync(path.join(outputDir, 'Album', 'keep', 'IMG_20250102_111111.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.03 - Event', 'IMG_20250103_111111.jpg')));
  assert.ok(fs.existsSync(path.join(outputDir, '2025.01.03 - Event', 'IMG_20250103_121111.jpg')));
});

test('manual assignments can move media from preserved directories during review', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['Album/IMG_20250102_111111.jpg']);
  const { assignGroupingItems, createGroupingWorkspace, getGroupingWorkspace, reorganizeGroupingWorkspace } = await import(
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

  const afterAssignment = getGroupingWorkspace(workspace.sessionId);
  assert.equal(afterAssignment?.folders.find((folder) => folder.label === 'Manual')?.itemCount, 1);
  assert.equal(afterAssignment?.items[0].targetGroupLabel, 'Manual');
  assert.equal(afterAssignment?.items[0].preservedStructure, false);
});

test('deleteGroupingItems can delete media from preserved directories during review', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['Album/IMG_20250102_111111.jpg']);
  const { createGroupingWorkspace, deleteGroupingItems, getGroupingWorkspace, reorganizeGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple'],
    preservedDirectories: ['source/Album'],
    reorganizedDirectories: []
  });

  deleteGroupingItems(workspace.sessionId, [items[0].itemId]);

  const afterDelete = getGroupingWorkspace(workspace.sessionId);
  assert.equal(afterDelete?.items.length, 0);
});

test('manual edits are allowed for reorganized child directories inside a preserved parent', async () => {
  const { compressionSessionId, items } = seedCompressionSession([
    'Album/keep/IMG_20250102_111111.jpg',
    'Album/reorganize/IMG_20250103_111111.jpg',
    'Album/reorganize/IMG_20250103_121111.jpg'
  ]);
  const { assignGroupingItems, createGroupingWorkspace, deleteGroupingItems, getGroupingWorkspace, reorganizeGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const proposed = reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple'],
    preservedDirectories: ['source/Album'],
    reorganizedDirectories: ['source/Album/reorganize']
  });
  const keptItem = items.find((item) => item.relativePath.includes('/keep/'));
  const reorganizedItems = items.filter((item) => item.relativePath.includes('/reorganize/'));

  assert.ok(keptItem);
  assert.equal(proposed.items.find((item) => item.id === keptItem.itemId)?.preservedStructure, true);
  assert.ok(reorganizedItems.every((item) => proposed.items.find((candidate) => candidate.id === item.itemId)?.preservedStructure === false));

  assignGroupingItems(workspace.sessionId, [reorganizedItems[0].itemId], 'Manual');
  deleteGroupingItems(workspace.sessionId, [reorganizedItems[1].itemId]);

  const afterEdits = getGroupingWorkspace(workspace.sessionId);
  assert.equal(afterEdits?.items.find((item) => item.id === reorganizedItems[0].itemId)?.targetGroupLabel, 'Manual');
  assert.equal(afterEdits?.items.find((item) => item.id === reorganizedItems[1].itemId), undefined);
  assert.equal(afterEdits?.items.find((item) => item.id === keptItem.itemId)?.preservedStructure, true);
});

test('renaming a preserved scope converts its items into a manual folder assignment', async () => {
  const { compressionSessionId, items } = seedCompressionSession([
    'Album/keep/IMG_20250102_111111.jpg',
    'Album/keep/IMG_20250102_121111.jpg'
  ]);
  const {
    createGroupingWorkspace,
    getGroupingWorkspace,
    renamePreservedGroupingFolderScope,
    reorganizeGroupingWorkspace
  } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  reorganizeGroupingWorkspace(workspace.sessionId, {
    rules: ['date-event-multiple'],
    preservedDirectories: ['source/Album'],
    reorganizedDirectories: []
  });

  const renamed = renamePreservedGroupingFolderScope(workspace.sessionId, 'source/Album', 'Album curated');

  assert.equal(renamed?.folders.find((folder) => folder.label === 'Album curated')?.itemCount, 2);
  assert.ok(renamed?.items.every((item) => item.targetGroupLabel === 'Album curated'));
  assert.ok(renamed?.items.every((item) => item.preservedStructure === false));
  assert.equal(getGroupingWorkspace(workspace.sessionId)?.items.filter((item) => item.preservedStructure).length, 0);
  assert.deepEqual(items.map((item) => item.itemId).sort(), renamed?.items.map((item) => item.id).sort());
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

test('applyGroupingWorkspace verifies expected media against destination files', async () => {
  const { compressionSessionId } = seedCompressionSession(['photo.jpg', 'clip.mp4']);
  const { applyGroupingWorkspace, createGroupingWorkspace } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.verification.status, 'ok');
  assert.deepEqual(result?.verification.expected, { total: 2, images: 1, videos: 1, unknown: 0 });
  assert.deepEqual(result?.verification.destination, { total: 2, images: 1, videos: 1, unknown: 0 });
});

test('applyGroupingWorkspace can be safely run twice without creating new collision names', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['album-a/photo.jpg', 'album-b/photo.jpg']);
  const { applyGroupingWorkspace, assignGroupingItems, createGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js?apply-idempotent=1'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  assignGroupingItems(
    workspace.sessionId,
    items.map((item) => item.itemId),
    'Party'
  );

  const firstApply = applyGroupingWorkspace(workspace.sessionId);
  const secondApply = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(firstApply?.movedItems, 2);
  assert.equal(secondApply?.movedItems, 0);
  assert.equal(fs.existsSync(path.join(outputDir, 'Party', 'photo.jpg')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'Party', 'photo (2).jpg')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'Party', 'photo (3).jpg')), false);
});

test('applyGroupingWorkspace moves already-applied files when grouping assignments change', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['album-a/photo.jpg', 'album-b/photo.jpg']);
  const { applyGroupingWorkspace, assignGroupingItems, createGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js?apply-reassignment=1'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  assignGroupingItems(
    workspace.sessionId,
    items.map((item) => item.itemId),
    'Party'
  );
  applyGroupingWorkspace(workspace.sessionId);

  assignGroupingItems(workspace.sessionId, [items[1].itemId], 'Other');
  const result = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(result?.status, 'completed');
  assert.equal(result?.movedItems, 1);
  assert.equal(fs.existsSync(path.join(outputDir, 'Party', 'photo.jpg')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'Party', 'photo (2).jpg')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'Other', 'photo.jpg')), true);
});

test('resetGroupingWorkspace restores deleted destination files from grouping backups', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['keep.jpg', 'delete.jpg']);
  const { applyGroupingWorkspace, createGroupingWorkspace, deleteGroupingItems, getGroupingWorkspace, resetGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js?reset-restore=1'
  );
  const deletedItem = items.find((item) => item.relativePath === 'delete.jpg');
  assert.ok(deletedItem);

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  deleteGroupingItems(workspace.sessionId, [deletedItem.itemId]);
  const applyResult = applyGroupingWorkspace(workspace.sessionId);

  assert.equal(applyResult?.deletedItems, 1);
  assert.equal(fs.existsSync(path.join(outputDir, 'delete.jpg')), false);

  const resetResult = resetGroupingWorkspace(workspace.sessionId);
  const afterReset = getGroupingWorkspace(workspace.sessionId);
  const decision = getDb()
    .prepare('SELECT selected_for_output, target_group_label, user_overridden FROM item_decisions WHERE session_id = ? AND item_id = ?')
    .get(compressionSessionId, deletedItem.itemId) as { selected_for_output: number; target_group_label: string | null; user_overridden: number };

  assert.equal(resetResult?.status, 'completed');
  assert.equal(resetResult?.restoredItems, 1);
  assert.equal(fs.existsSync(path.join(outputDir, 'delete.jpg')), true);
  assert.equal(fs.readFileSync(path.join(outputDir, 'delete.jpg'), 'utf8'), 'output delete.jpg');
  assert.equal(decision.selected_for_output, 1);
  assert.equal(decision.target_group_label, null);
  assert.equal(decision.user_overridden, 0);
  assert.equal(afterReset?.items.length, 2);
  assert.deepEqual(afterReset?.folders, []);
});

test('resetGroupingWorkspace removes empty grouping folders and restores baseline relative paths', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['album-a/photo.jpg', 'album-b/clip.mp4']);
  const { applyGroupingWorkspace, assignGroupingItems, createGroupingWorkspace, getGroupingWorkspace, resetGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js?reset-folders=1'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  assignGroupingItems(
    workspace.sessionId,
    items.map((item) => item.itemId),
    'Party'
  );
  applyGroupingWorkspace(workspace.sessionId);

  assert.equal(fs.existsSync(path.join(outputDir, 'Party', 'photo.jpg')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'Party', 'clip.mp4')), true);

  const resetResult = resetGroupingWorkspace(workspace.sessionId);
  const afterReset = getGroupingWorkspace(workspace.sessionId);

  assert.equal(resetResult?.status, 'completed');
  assert.equal(fs.existsSync(path.join(outputDir, 'Party')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'album-a', 'photo.jpg')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'album-b', 'clip.mp4')), true);
  assert.deepEqual(
    afterReset?.items.map((item) => item.relativePath).sort(),
    ['album-a/photo.jpg', 'album-b/clip.mp4'].sort()
  );
});

test('resetGroupingWorkspace reports partial failure when a deleted file backup is missing', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['delete.jpg']);
  const { applyGroupingWorkspace, createGroupingWorkspace, deleteGroupingItems, resetGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js?reset-missing-backup=1'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  deleteGroupingItems(workspace.sessionId, [items[0].itemId]);
  applyGroupingWorkspace(workspace.sessionId);
  fs.rmSync(path.join(outputDir, '.media-organizer', 'grouping-baselines', workspace.sessionId, 'delete.jpg'), { force: true });

  const resetResult = resetGroupingWorkspace(workspace.sessionId);

  assert.equal(resetResult?.status, 'partial_failed');
  assert.equal(resetResult?.failedItems, 1);
  assert.equal(resetResult?.errors[0].relativePath, 'delete.jpg');
  assert.equal(fs.existsSync(path.join(outputDir, 'delete.jpg')), false);
});

test('resetGroupingWorkspace refuses baseline paths outside the destination folder', async () => {
  const { compressionSessionId } = seedCompressionSession(['inside.jpg']);
  const { createGroupingWorkspace, resetGroupingWorkspace } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js?reset-path-traversal=1'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  getDb()
    .prepare('UPDATE grouping_item_baselines SET initial_relative_path = ? WHERE grouping_session_id = ?')
    .run(path.join('..', 'outside.jpg'), workspace.sessionId);

  assert.throws(() => resetGroupingWorkspace(workspace.sessionId), /outside the destination folder/);
});

test('verifyGroupingWorkspaceDestination reports mismatch when a destination file is missing', async () => {
  const { compressionSessionId } = seedCompressionSession(['photo.jpg', 'clip.mp4']);
  const { createGroupingWorkspace, verifyGroupingWorkspaceDestination } = await import('../src/pipeline/grouping/groupingWorkspace.service.js');

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  fs.rmSync(path.join(outputDir, 'clip.mp4'));

  const verification = verifyGroupingWorkspaceDestination(workspace.sessionId, '2026-05-26T10:00:00.000Z');

  assert.equal(verification?.status, 'mismatch');
  assert.deepEqual(verification?.expected, { total: 2, images: 1, videos: 1, unknown: 0 });
  assert.deepEqual(verification?.destination, { total: 1, images: 1, videos: 0, unknown: 0 });
});

test('destination verification ignores excluded output items and metadata directory', async () => {
  const { compressionSessionId, items } = seedCompressionSession(['keep.jpg', 'delete.jpg']);
  const { createGroupingWorkspace, deleteGroupingItems, verifyGroupingWorkspaceDestination } = await import(
    '../src/pipeline/grouping/groupingWorkspace.service.js'
  );

  const workspace = createGroupingWorkspace({ sourceDir, outputDir, compressionSessionId });
  const deletedItem = items.find((item) => item.relativePath === 'delete.jpg');
  assert.ok(deletedItem);

  deleteGroupingItems(workspace.sessionId, [deletedItem.itemId]);
  fs.rmSync(path.join(outputDir, 'delete.jpg'));
  fs.mkdirSync(path.join(outputDir, '.media-organizer'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, '.media-organizer', 'debug.txt'), 'ignored');

  const verification = verifyGroupingWorkspaceDestination(workspace.sessionId, '2026-05-26T10:00:00.000Z');

  assert.equal(verification?.status, 'ok');
  assert.deepEqual(verification?.expected, { total: 1, images: 1, videos: 0, unknown: 0 });
  assert.deepEqual(verification?.destination, { total: 1, images: 1, videos: 0, unknown: 0 });
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
