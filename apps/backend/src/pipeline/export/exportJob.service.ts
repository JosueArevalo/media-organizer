import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import type {
  ExportCheckpointRecord,
  ExportItemRecord,
  ExportJobRecord,
  ExportJobRequest,
  ExportJobSnapshot,
  ExportProgressData,
  ExportTarget,
  ExportTargetTestResult,
  GooglePhotosAlbumProgress,
  GooglePhotosExportPreview,
  GooglePhotosTarget,
  NetworkCredentials
} from './export.types.js';
import {
  authenticateNetworkPath,
  getNetworkErrorMessage,
  markNetworkDestinationUsed,
  parseMountedPath,
  parseUncPath
} from './networkDestination.service.js';
import {
  ensureGooglePhotosItemMetadata,
  getCachedGooglePhotosAlbumByTitle,
  listGooglePhotosAppCreatedAlbums
} from './googlePhotosApi.service.js';
import { getGooglePhotosAccount } from './googlePhotosAuth.service.js';

const nowIso = () => new Date().toISOString();

const INTERNAL_DIRECTORY_NAME = '.media-organizer';

const toJobRecord = (row: {
  id: string;
  name: string | null;
  source_root: string;
  target_type: ExportJobRecord['targetType'];
  target_path: string | null;
  execution_id: string | null;
  destination_label: string | null;
  eligible_items: number;
  eligible_albums: number;
  status: ExportJobRecord['status'];
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}): ExportJobRecord => ({
  id: row.id,
  name: row.name,
  sourceRoot: row.source_root,
  targetType: row.target_type,
  targetPath: row.target_path,
  executionId: row.execution_id,
  destinationLabel: row.destination_label,
  eligibleItems: row.eligible_items,
  eligibleAlbums: row.eligible_albums,
  status: row.status,
  totalItems: row.total_items,
  completedItems: row.completed_items,
  failedItems: row.failed_items,
  skippedItems: row.skipped_items,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastOpenedAt: row.last_opened_at
});

const toItemRecord = (row: {
  id: string;
  job_id: string;
  source_path: string;
  relative_path: string;
  destination_path: string;
  size_bytes: number;
  status: ExportItemRecord['status'];
  attempt_count: number;
  last_error: string | null;
  updated_at: string;
}): ExportItemRecord => ({
  id: row.id,
  jobId: row.job_id,
  sourcePath: row.source_path,
  relativePath: row.relative_path,
  destinationPath: row.destination_path,
  sizeBytes: row.size_bytes,
  status: row.status,
  attemptCount: row.attempt_count,
  lastError: row.last_error,
  updatedAt: row.updated_at
});

const toCheckpointRecord = (row: {
  id: string;
  job_id: string;
  cursor: string | null;
  payload_json: string | null;
  updated_at: string;
}): ExportCheckpointRecord => ({
  id: row.id,
  jobId: row.job_id,
  cursor: row.cursor,
  payloadJson: row.payload_json,
  updatedAt: row.updated_at
});

const normalizeExistingPath = (value: string) => path.resolve(value);

export const normalizeNetworkDestinationPath = (
  value: string,
  platform: NodeJS.Platform = process.platform
) => {
  if (platform !== 'win32') {
    return parseMountedPath(value);
  }

  try {
    return parseUncPath(value).normalized;
  } catch {
    return value.trim().replace(/[\\/]+$/, '');
  }
};

export const normalizeNetworkDestinationPathForComparison = (
  value: string,
  platform: NodeJS.Platform = process.platform
) => {
  const normalized = normalizeNetworkDestinationPath(value, platform);
  return platform === 'win32' ? normalized.replaceAll('/', '\\').toLocaleLowerCase() : normalized;
};

const supportedGooglePhotosExtensions = new Set([
  '.3gp',
  '.3g2',
  '.avi',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpg',
  '.jpeg',
  '.m2ts',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpg',
  '.mts',
  '.png',
  '.tif',
  '.tiff',
  '.webp'
]);

const isPathInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

export const collectExportFilePlan = (sourceRoot: string, destinationRoot: string) => {
  const resolvedSourceRoot = normalizeExistingPath(sourceRoot);
  const resolvedDestinationRoot = normalizeExistingPath(destinationRoot);
  const items: Array<{ sourcePath: string; relativePath: string; destinationPath: string; sizeBytes: number }> = [];

  const walk = (directoryPath: string) => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === INTERNAL_DIRECTORY_NAME) {
        continue;
      }

      const sourcePath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        walk(sourcePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(resolvedSourceRoot, sourcePath);
      items.push({
        sourcePath,
        relativePath,
        destinationPath: path.join(resolvedDestinationRoot, relativePath),
        sizeBytes: fs.statSync(sourcePath).size
      });
    }
  };

  walk(resolvedSourceRoot);
  return items;
};

const assertExistingSourceRoot = (sourceRoot: string) => {
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error('Export sourceRoot must be an existing directory.');
  }
};

export const getGooglePhotosAlbumTitleForRelativePath = (relativePath: string) => {
  const segments = relativePath.split(path.sep).filter(Boolean);
  return segments.length > 1 ? segments[0] : path.basename(path.dirname(relativePath)) || 'Media Organizer';
};

export const isGooglePhotosSupportedFile = (filePath: string) =>
  supportedGooglePhotosExtensions.has(path.extname(filePath).toLocaleLowerCase());

export const collectGooglePhotosFilePlan = (sourceRoot: string) => {
  const resolvedSourceRoot = normalizeExistingPath(sourceRoot);
  const items: Array<{
    sourcePath: string;
    relativePath: string;
    destinationPath: string;
    sizeBytes: number;
    albumTitle: string;
    supported: boolean;
  }> = [];

  const walk = (directoryPath: string) => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === INTERNAL_DIRECTORY_NAME) {
        continue;
      }

      const sourcePath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        walk(sourcePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(resolvedSourceRoot, sourcePath);
      const albumTitle = getGooglePhotosAlbumTitleForRelativePath(relativePath);
      items.push({
        sourcePath,
        relativePath,
        destinationPath: albumTitle,
        sizeBytes: fs.statSync(sourcePath).size,
        albumTitle,
        supported: isGooglePhotosSupportedFile(sourcePath)
      });
    }
  };

  walk(resolvedSourceRoot);
  return items;
};

const filterGooglePhotosFilePlan = (
  plannedItems: ReturnType<typeof collectGooglePhotosFilePlan>,
  target: GooglePhotosTarget
) => {
  const albumTitles = target.albumTitles?.map((title) => title.trim()).filter(Boolean);

  if (!albumTitles?.length) {
    return plannedItems;
  }

  const selectedAlbums = new Set(albumTitles);
  return plannedItems.filter((item) => selectedAlbums.has(item.albumTitle));
};

const parseGooglePhotosCheckpointTarget = (payloadJson: string | null): GooglePhotosTarget | null => {
  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as { target?: ExportTarget };
    return payload.target?.type === 'google-photos' ? payload.target : null;
  } catch {
    return null;
  }
};

const getCompletedGooglePhotosSourcePaths = (input: {
  accountId: string;
  executionId: string | null;
  sourceRoot: string;
}) => {
  const db = getDb();
  const rows = input.executionId
    ? db.prepare(
        `
          SELECT DISTINCT export_items.source_path
          FROM export_items
          JOIN export_jobs ON export_jobs.id = export_items.job_id
          JOIN export_google_photos_items ON export_google_photos_items.item_id = export_items.id
          WHERE export_jobs.target_type = 'google-photos'
            AND export_jobs.execution_id = ?
            AND export_google_photos_items.account_id = ?
            AND export_items.status = 'completed'
        `
      ).all(input.executionId, input.accountId)
    : db.prepare(
        `
          SELECT DISTINCT export_items.source_path
          FROM export_items
          JOIN export_jobs ON export_jobs.id = export_items.job_id
          JOIN export_google_photos_items ON export_google_photos_items.item_id = export_items.id
          WHERE export_jobs.target_type = 'google-photos'
            AND export_jobs.execution_id IS NULL
            AND export_jobs.source_root = ?
            AND export_google_photos_items.account_id = ?
            AND export_items.status = 'completed'
        `
      ).all(input.sourceRoot, input.accountId);

  return new Set((rows as Array<{ source_path: string }>).map((row) => row.source_path));
};

const isGooglePhotosAlbumCompleted = (
  albumItems: Array<{ sourcePath: string; supported: boolean }>,
  completedSourcePaths: Set<string>
) => {
  const supportedItems = albumItems.filter((item) => item.supported);
  return supportedItems.length > 0 && supportedItems.every((item) => completedSourcePaths.has(item.sourcePath));
};

const getGooglePhotosItemStateBySourcePath = (input: {
  accountId: string;
  executionId: string | null;
  sourceRoot: string;
}) => {
  const db = getDb();
  const rows = input.executionId
    ? db.prepare(
        `
          SELECT
            export_items.id,
            export_items.job_id,
            export_items.source_path,
            export_items.status,
            export_items.last_error,
            export_items.updated_at
          FROM export_items
          JOIN export_jobs ON export_jobs.id = export_items.job_id
          JOIN export_google_photos_items ON export_google_photos_items.item_id = export_items.id
          WHERE export_jobs.target_type = 'google-photos'
            AND export_jobs.execution_id = ?
            AND export_google_photos_items.account_id = ?
            AND (
              export_items.status <> 'pending'
              OR export_google_photos_items.phase IN ('uploaded', 'created')
              OR export_google_photos_items.upload_token IS NOT NULL
              OR export_google_photos_items.media_item_id IS NOT NULL
            )
          ORDER BY datetime(export_items.updated_at) DESC, export_items.rowid DESC
        `
      ).all(input.executionId, input.accountId)
    : db.prepare(
        `
          SELECT
            export_items.id,
            export_items.job_id,
            export_items.source_path,
            export_items.status,
            export_items.last_error,
            export_items.updated_at
          FROM export_items
          JOIN export_jobs ON export_jobs.id = export_items.job_id
          JOIN export_google_photos_items ON export_google_photos_items.item_id = export_items.id
          WHERE export_jobs.target_type = 'google-photos'
            AND export_jobs.execution_id IS NULL
            AND export_jobs.source_root = ?
            AND export_google_photos_items.account_id = ?
            AND (
              export_items.status <> 'pending'
              OR export_google_photos_items.phase IN ('uploaded', 'created')
              OR export_google_photos_items.upload_token IS NOT NULL
              OR export_google_photos_items.media_item_id IS NOT NULL
            )
          ORDER BY datetime(export_items.updated_at) DESC, export_items.rowid DESC
        `
      ).all(input.sourceRoot, input.accountId) as Array<{
        id: string;
        job_id: string;
        source_path: string;
        status: ExportItemRecord['status'];
        last_error: string | null;
        updated_at: string;
      }>;

  const entries = new Map<string, {
    id: string;
    jobId: string;
    status: ExportItemRecord['status'];
    lastError: string | null;
    updatedAt: string;
  }>();

  for (const row of rows) {
    if (entries.has(row.source_path)) {
      continue;
    }

    entries.set(row.source_path, {
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      lastError: row.last_error,
      updatedAt: row.updated_at
    });
  }

  return entries;
};

const assertExportJobRequest = (request: ExportJobRequest) => {
  assertExistingSourceRoot(request.sourceRoot);

  if (request.target.type === 'google-photos') {
    if (!request.target.accountId?.trim()) {
      throw new Error('Google Photos accountId is required.');
    }

    if (!getGooglePhotosAccount(request.target.accountId)) {
      throw new Error('Connect a Google Photos account before creating this export.');
    }

    return;
  }

  const resolvedSource = normalizeExistingPath(request.sourceRoot);
  const resolvedDestination = normalizeExistingPath(request.target.destinationPath);

  if (resolvedSource === resolvedDestination || isPathInside(resolvedSource, resolvedDestination)) {
    throw new Error('Export destination cannot be inside the source folder.');
  }
};

const resolveExecutionId = (groupingSessionId: string | undefined, sourceRoot: string) => {
  const db = getDb();
  const groupingRow = groupingSessionId
    ? db.prepare('SELECT id FROM execution_history WHERE grouping_session_id = ?').get(groupingSessionId) as { id: string } | undefined
    : undefined;
  if (groupingRow) return groupingRow.id;

  const row = db
    .prepare(
      `SELECT id
       FROM execution_history
       WHERE output_root = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`
    )
    .get(sourceRoot) as { id: string } | undefined;
  return row?.id ?? null;
};

export const createExportJob = (request: ExportJobRequest): ExportJobSnapshot => {
  runMigrations();
  assertExportJobRequest(request);

  const db = getDb();
  const timestamp = nowIso();
  const jobId = randomUUID();
  const targetPath = request.target.type === 'network-folder' ? normalizeNetworkDestinationPath(request.target.destinationPath) : null;
  const executionId = resolveExecutionId(request.groupingSessionId, request.sourceRoot);

  if (request.target.type === 'network-folder' && executionId) {
    const existingPaths = db
      .prepare(
        `SELECT target_path
         FROM export_jobs
         WHERE execution_id = ?
           AND target_type = 'network-folder'
           AND target_path IS NOT NULL`
      )
      .all(executionId) as Array<{ target_path: string }>;
    const normalizedTargetPath = normalizeNetworkDestinationPathForComparison(targetPath as string);

    if (existingPaths.some((row) => normalizeNetworkDestinationPathForComparison(row.target_path) === normalizedTargetPath)) {
      throw new Error('An export job already exists for this network destination in the current session.');
    }
  }

  const destinationLabel = request.target.type === 'network-folder'
    ? targetPath
    : getGooglePhotosAccount(request.target.accountId)?.email ?? null;
  const fullGooglePhotosPlan = request.target.type === 'google-photos' ? collectGooglePhotosFilePlan(request.sourceRoot) : null;
  const selectedGooglePhotosPlan = request.target.type === 'google-photos'
    ? filterGooglePhotosFilePlan(fullGooglePhotosPlan ?? [], request.target)
    : null;
  const eligibleItems = request.target.type === 'network-folder'
    ? collectExportFilePlan(request.sourceRoot, request.target.destinationPath).length
    : selectedGooglePhotosPlan?.filter((item) => item.supported).length ?? 0;
  const eligibleAlbums = request.target.type === 'google-photos'
    ? new Set(selectedGooglePhotosPlan?.filter((item) => item.supported).map((item) => item.albumTitle)).size
    : 0;
  const completedGooglePhotosSourcePaths = request.target.type === 'google-photos'
    ? getCompletedGooglePhotosSourcePaths({
        accountId: request.target.accountId,
        executionId,
        sourceRoot: request.sourceRoot
      })
    : null;
  const plannedItems = request.target.type === 'network-folder'
    ? collectExportFilePlan(request.sourceRoot, targetPath as string).map((item) => ({
        ...item,
        albumTitle: null,
        supported: true
      }))
    : (selectedGooglePhotosPlan ?? fullGooglePhotosPlan ?? []).filter((item) => {
        if (!item.supported) {
          return true;
        }

        return !completedGooglePhotosSourcePaths?.has(item.sourcePath);
      });

  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare(
      `
        INSERT INTO export_jobs (
          id,
          name,
          source_root,
          target_type,
          target_path,
          execution_id,
          destination_label,
          eligible_items,
          eligible_albums,
          status,
          total_items,
          completed_items,
          failed_items,
          skipped_items,
          last_error,
          created_at,
          updated_at,
          last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 0, 0, 0, NULL, ?, ?, ?)
      `
    ).run(
      jobId,
      request.name ?? null,
      request.sourceRoot,
      request.target.type,
      targetPath,
      executionId,
      destinationLabel,
      eligibleItems,
      eligibleAlbums,
      plannedItems.length,
      timestamp,
      timestamp,
      timestamp
    );

    const insertItem = db.prepare(
      `
        INSERT INTO export_items (
          id,
          job_id,
          source_path,
          relative_path,
          destination_path,
          size_bytes,
          status,
          attempt_count,
          last_error,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?)
      `
    );

    let skippedItems = 0;

    for (const item of plannedItems) {
      const itemId = randomUUID();
      insertItem.run(itemId, jobId, item.sourcePath, item.relativePath, item.destinationPath, item.sizeBytes, timestamp);

      if (request.target.type === 'google-photos') {
        ensureGooglePhotosItemMetadata(itemId, request.target.accountId, item.albumTitle ?? item.destinationPath);

        if (!item.supported) {
          skippedItems += 1;
          db.prepare(
            `
              UPDATE export_items
              SET status = 'skipped',
                  last_error = 'File type is not supported by Google Photos.',
                  updated_at = ?
              WHERE id = ?
            `
          ).run(timestamp, itemId);
        }
      }
    }

    if (skippedItems > 0) {
      db.prepare('UPDATE export_jobs SET skipped_items = ? WHERE id = ?').run(skippedItems, jobId);
    }

    db.prepare(
      `
        INSERT INTO export_checkpoints (id, job_id, cursor, payload_json, updated_at)
        VALUES (?, ?, NULL, ?, ?)
      `
    ).run(randomUUID(), jobId, JSON.stringify({
      target: request.target.type === 'network-folder'
        ? { ...request.target, destinationPath: targetPath }
        : request.target
    }), timestamp);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getExportJob(jobId) as ExportJobSnapshot;
};

export const updateGooglePhotosExportJobScope = (
  jobId: string,
  albumTitles: string[]
): ExportJobSnapshot | null => {
  runMigrations();
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    return null;
  }

  if (snapshot.job.targetType !== 'google-photos') {
    throw new Error('Only Google Photos export jobs support album scope updates.');
  }

  if (snapshot.job.status !== 'paused' && snapshot.job.status !== 'draft') {
    throw new Error('Google Photos album scope can only be changed while the export is paused.');
  }

  const target = parseGooglePhotosCheckpointTarget(snapshot.checkpoint?.payloadJson ?? null);
  if (!target?.accountId) {
    throw new Error('Google Photos export target metadata is missing.');
  }

  assertExistingSourceRoot(snapshot.job.sourceRoot);

  const db = getDb();
  const timestamp = nowIso();
  const requestedAlbums = new Set(albumTitles.map((title) => title.trim()).filter(Boolean));
  const protectedRows = db
    .prepare(
      `
        SELECT DISTINCT export_items.destination_path AS album_title
        FROM export_items
        LEFT JOIN export_google_photos_items ON export_google_photos_items.item_id = export_items.id
        WHERE export_items.job_id = ?
          AND (
            export_items.status IN ('completed', 'failed', 'skipped', 'running')
            OR export_google_photos_items.phase IN ('uploaded', 'created')
            OR export_google_photos_items.upload_token IS NOT NULL
            OR export_google_photos_items.media_item_id IS NOT NULL
          )
      `
    )
    .all(jobId) as Array<{ album_title: string }>;
  const protectedAlbums = new Set(protectedRows.map((row) => row.album_title));
  const effectiveAlbums = new Set([...requestedAlbums, ...protectedAlbums]);
  const plannedItems = effectiveAlbums.size > 0
    ? filterGooglePhotosFilePlan(collectGooglePhotosFilePlan(snapshot.job.sourceRoot), {
        type: 'google-photos',
        accountId: target.accountId,
        albumTitles: [...effectiveAlbums]
      })
    : [];
  const supportedPlannedItems = plannedItems.filter((item) => item.supported);
  const completedSourcePaths = getCompletedGooglePhotosSourcePaths({
    accountId: target.accountId,
    executionId: snapshot.job.executionId,
    sourceRoot: snapshot.job.sourceRoot
  });
  const insertableItems = plannedItems.filter((item) => !item.supported || !completedSourcePaths.has(item.sourcePath));

  try {
    db.exec('BEGIN TRANSACTION');

    db.prepare(
      `
        DELETE FROM export_items
        WHERE job_id = ?
          AND status = 'pending'
          AND destination_path NOT IN (${effectiveAlbums.size > 0 ? [...effectiveAlbums].map(() => '?').join(', ') : "''"})
      `
    ).run(jobId, ...effectiveAlbums);

    const existingRows = db
      .prepare('SELECT source_path FROM export_items WHERE job_id = ?')
      .all(jobId) as Array<{ source_path: string }>;
    const existingSourcePaths = new Set(existingRows.map((row) => row.source_path));
    const insertItem = db.prepare(
      `
        INSERT INTO export_items (
          id,
          job_id,
          source_path,
          relative_path,
          destination_path,
          size_bytes,
          status,
          attempt_count,
          last_error,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?)
      `
    );

    for (const item of insertableItems) {
      if (existingSourcePaths.has(item.sourcePath)) {
        continue;
      }

      const itemId = randomUUID();
      insertItem.run(itemId, jobId, item.sourcePath, item.relativePath, item.destinationPath, item.sizeBytes, timestamp);
      ensureGooglePhotosItemMetadata(itemId, target.accountId, item.albumTitle);
      existingSourcePaths.add(item.sourcePath);

      if (!item.supported) {
        db.prepare(
          `
            UPDATE export_items
            SET status = 'skipped',
                last_error = 'File type is not supported by Google Photos.',
                updated_at = ?
            WHERE id = ?
          `
        ).run(timestamp, itemId);
      }
    }

    const nextTarget: GooglePhotosTarget = {
      ...target,
      albumTitles: [...effectiveAlbums].sort((left, right) => left.localeCompare(right))
    };

    db.prepare(
      `
        UPDATE export_jobs
        SET eligible_items = ?,
            eligible_albums = ?,
            last_error = NULL,
            updated_at = ?,
            last_opened_at = ?
        WHERE id = ?
      `
    ).run(
      supportedPlannedItems.length,
      new Set(supportedPlannedItems.map((item) => item.albumTitle)).size,
      timestamp,
      timestamp,
      jobId
    );

    db.prepare(
      `
        UPDATE export_checkpoints
        SET payload_json = ?, updated_at = ?
        WHERE job_id = ?
      `
    ).run(JSON.stringify({ target: nextTarget }), timestamp, jobId);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const refreshed = refreshExportJobCounters(jobId, snapshot.job.status);

  if (effectiveAlbums.size === 0 && refreshed) {
    db.prepare(
      `
        UPDATE export_jobs
        SET status = ?, updated_at = ?, last_opened_at = ?
        WHERE id = ?
      `
    ).run(snapshot.job.status, nowIso(), nowIso(), jobId);

    return getExportJob(jobId);
  }

  return refreshed;
};

export const getExportJob = (jobId: string): ExportJobSnapshot | null => {
  runMigrations();
  const db = getDb();
  const jobRow = db
    .prepare('SELECT * FROM export_jobs WHERE id = ?')
    .get(jobId) as Parameters<typeof toJobRecord>[0] | undefined;

  if (!jobRow) {
    return null;
  }

  const checkpointRow = db
    .prepare('SELECT * FROM export_checkpoints WHERE job_id = ?')
    .get(jobId) as Parameters<typeof toCheckpointRecord>[0] | undefined;

  const recentRows = db
    .prepare(
      `
        SELECT *
        FROM export_items
        WHERE job_id = ?
        ORDER BY updated_at DESC
        LIMIT 50
      `
    )
    .all(jobId) as Array<Parameters<typeof toItemRecord>[0]>;

  return {
    job: toJobRecord(jobRow),
    checkpoint: checkpointRow ? toCheckpointRecord(checkpointRow) : null,
    recentItems: recentRows.map(toItemRecord)
  };
};

export const listExportJobs = (input: {
  targetType?: ExportJobRecord['targetType'] | null;
  groupingSessionId?: string | null;
  sourceRoot?: string | null;
}) => {
  runMigrations();
  const executionId = resolveExecutionId(input.groupingSessionId ?? undefined, input.sourceRoot ?? '');

  if (!executionId) {
    return [];
  }

  const db = getDb();
  const rows = input.targetType
    ? db.prepare(
        `SELECT id
         FROM export_jobs
         WHERE execution_id = ? AND target_type = ?
         ORDER BY datetime(created_at) DESC, rowid DESC`
      ).all(executionId, input.targetType)
    : db.prepare(
        `SELECT id
         FROM export_jobs
         WHERE execution_id = ?
         ORDER BY datetime(created_at) DESC, rowid DESC`
      ).all(executionId);

  return (rows as Array<{ id: string }>)
    .map((row) => getExportJob(row.id))
    .filter((snapshot): snapshot is ExportJobSnapshot => Boolean(snapshot));
};

export const assertExportJobCanStart = (jobId: string) => {
  runMigrations();
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    throw new Error('Export job not found.');
  }

  if (snapshot.job.targetType !== 'network-folder') {
    return snapshot;
  }

  if (snapshot.job.status === 'completed') {
    throw new Error('Completed network folder export jobs cannot be started again.');
  }

  const otherRunningJob = getDb()
    .prepare(
      `SELECT id
       FROM export_jobs
       WHERE target_type = 'network-folder'
         AND status = 'running'
         AND id <> ?
       LIMIT 1`
    )
    .get(jobId) as { id: string } | undefined;

  if (otherRunningJob) {
    throw new Error('Another network folder export is already running.');
  }

  return snapshot;
};

export const getExportProgress = (jobId: string): ExportProgressData | null => {
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    return null;
  }

  const albumProgress = snapshot.job.targetType === 'google-photos'
    ? getGooglePhotosAlbumProgress(jobId)
    : undefined;

  return {
    jobId,
    status: snapshot.job.status,
    total: snapshot.job.totalItems,
    completed: snapshot.job.completedItems,
    failed: snapshot.job.failedItems,
    skipped: snapshot.job.skippedItems,
    pending: Math.max(0, snapshot.job.totalItems - snapshot.job.completedItems - snapshot.job.failedItems - snapshot.job.skippedItems),
    recentItems: snapshot.recentItems,
    albumProgress
  };
};

const toAlbumProgressStatus = (row: {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  running: number;
}): GooglePhotosAlbumProgress['status'] => {
  if (row.failed > 0) {
    return 'failed';
  }

  if (row.running > 0) {
    return 'running';
  }

  if (row.skipped === row.total) {
    return 'skipped';
  }

  if (row.completed + row.skipped >= row.total) {
    return 'completed';
  }

  return 'pending';
};

const getGooglePhotosAlbumProgress = (jobId: string): GooglePhotosAlbumProgress[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          destination_path AS album_title,
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
        FROM export_items
        WHERE job_id = ?
        GROUP BY destination_path
        ORDER BY destination_path ASC
      `
    )
    .all(jobId) as Array<{
      album_title: string;
      total: number;
      completed: number | null;
      failed: number | null;
      skipped: number | null;
      running: number | null;
    }>;

  return rows.map((row) => {
    const completed = row.completed ?? 0;
    const failed = row.failed ?? 0;
    const skipped = row.skipped ?? 0;

    return {
      albumTitle: row.album_title,
      total: row.total,
      completed,
      failed,
      skipped,
      pending: Math.max(0, row.total - completed - failed - skipped),
      status: toAlbumProgressStatus({
        total: row.total,
        completed,
        failed,
        skipped,
        running: row.running ?? 0
      })
    };
  });
};

export const updateExportJobStatus = (jobId: string, status: ExportJobRecord['status'], lastError: string | null = null) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE export_jobs
      SET status = ?, last_error = ?, updated_at = ?, last_opened_at = ?
      WHERE id = ?
    `
  ).run(status, lastError, timestamp, timestamp, jobId);

  return getExportJob(jobId);
};

export const pauseExportJob = (jobId: string) => {
  updateExportJobStatus(jobId, 'paused');
  return refreshExportJobCounters(jobId, 'paused');
};

export const markExportJobRunning = (jobId: string) => updateExportJobStatus(jobId, 'running');

export const markExportJobFailed = (jobId: string, error: Error) => updateExportJobStatus(jobId, 'failed', error.message);

export const reconcileInterruptedExportJobs = () => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();
  const rows = db.prepare("SELECT id FROM export_jobs WHERE status = 'running'").all() as Array<{ id: string }>;

  for (const row of rows) {
    db.prepare(
      `
        UPDATE export_items
        SET status = 'pending',
            last_error = NULL,
            updated_at = ?
        WHERE job_id = ?
          AND status = 'running'
      `
    ).run(timestamp, row.id);

    db.prepare(
      `
        UPDATE export_jobs
        SET status = 'paused',
            last_error = NULL,
            updated_at = ?,
            last_opened_at = ?
        WHERE id = ?
      `
    ).run(timestamp, timestamp, row.id);
  }

  return rows.length;
};

export const retryFailedExportItems = (jobId: string): ExportJobSnapshot | null => {
  runMigrations();
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    return null;
  }

  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE export_items
      SET status = 'pending', last_error = NULL, updated_at = ?
      WHERE job_id = ? AND status IN ('failed', 'running')
    `
  ).run(timestamp, jobId);

  db.prepare(
    `
      UPDATE export_jobs
      SET status = 'draft', failed_items = 0, last_error = NULL, updated_at = ?, last_opened_at = ?
      WHERE id = ?
    `
  ).run(timestamp, timestamp, jobId);

  return getExportJob(jobId);
};

export const retryExportItem = (jobId: string, itemId: string): ExportJobSnapshot | null => {
  runMigrations();
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare('SELECT status FROM export_items WHERE job_id = ? AND id = ?')
    .get(jobId, itemId) as { status: ExportItemRecord['status'] } | undefined;

  if (!row) {
    return null;
  }

  if (row.status !== 'failed') {
    throw new Error('Only failed export items can be retried.');
  }

  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE export_items
      SET status = 'pending',
          last_error = NULL,
          updated_at = ?
      WHERE job_id = ? AND id = ?
    `
  ).run(timestamp, jobId, itemId);

  if (snapshot.job.status !== 'running') {
    db.prepare(
      `
        UPDATE export_jobs
        SET status = 'draft',
            last_error = NULL,
            updated_at = ?,
            last_opened_at = ?
        WHERE id = ?
      `
    ).run(timestamp, timestamp, jobId);
  }

  return refreshExportJobCounters(jobId, snapshot.job.status === 'running' ? 'running' : 'draft');
};

export const testExportTarget = async (target: ExportTarget, credentials?: NetworkCredentials): Promise<ExportTargetTestResult> => {
  if (target.type === 'google-photos') {
    const account = target.accountId ? getGooglePhotosAccount(target.accountId) : null;

    return {
      ok: Boolean(account),
      targetType: target.type,
      message: account ? 'Google Photos account is connected.' : 'Connect a Google Photos account before exporting.',
      details: account?.email ?? null,
      requiresAuthentication: !account
    };
  }

  try {
    if (!target.destinationPath.trim()) {
      return {
        ok: false,
        targetType: target.type,
        message: 'Destination path is required.',
        details: null,
        requiresAuthentication: false
      };
    }

    if (credentials?.username?.trim() || credentials?.password) {
      await authenticateNetworkPath({ path: target.destinationPath, credentials });
    }

    if (process.platform === 'win32') {
      fs.mkdirSync(target.destinationPath, { recursive: true });
    } else if (!fs.existsSync(target.destinationPath) || !fs.statSync(target.destinationPath).isDirectory()) {
      throw new Error('Mounted folder is not available. Reconnect it with your operating system and try again.');
    }

    fs.accessSync(target.destinationPath, fs.constants.R_OK | fs.constants.W_OK);
    markNetworkDestinationUsed(target.destinationPath);

    return {
      ok: true,
      targetType: target.type,
      message: 'Destination is reachable and writable.',
      details: null,
      requiresAuthentication: false
    };
  } catch (error) {
    const networkError = getNetworkErrorMessage(error);

    return {
      ok: false,
      targetType: target.type,
      message: networkError.message,
      details: networkError.details,
      requiresAuthentication: networkError.requiresAuthentication
    };
  }
};

export const previewGooglePhotosExport = async (
  accountId: string,
  sourceRoot: string,
  groupingSessionId?: string
): Promise<GooglePhotosExportPreview> => {
  runMigrations();
  assertExistingSourceRoot(sourceRoot);

  const account = getGooglePhotosAccount(accountId);

  if (!account) {
    throw new Error('Connect a Google Photos account before previewing this export.');
  }

  await listGooglePhotosAppCreatedAlbums(accountId);
  const plannedItems = collectGooglePhotosFilePlan(sourceRoot);
  const supportedItems = plannedItems.filter((item) => item.supported);
  const executionId = resolveExecutionId(groupingSessionId, sourceRoot);
  const completedSourcePaths = getCompletedGooglePhotosSourcePaths({
    accountId,
    executionId,
    sourceRoot
  });
  const itemStateBySourcePath = getGooglePhotosItemStateBySourcePath({
    accountId,
    executionId,
    sourceRoot
  });
  const albumMap = new Map<string, {
    folderName: string;
    albumTitle: string;
    itemCount: number;
    sourceItems: Array<{ sourcePath: string; supported: boolean }>;
      items: Array<{
        relativePath: string;
        sizeBytes: number;
        supported: boolean;
        id?: string | null;
        jobId?: string | null;
        status?: ExportItemRecord['status'];
        lastError?: string | null;
      }>;
  }>();

  for (const item of supportedItems) {
    const existing = albumMap.get(item.albumTitle) ?? {
      folderName: item.albumTitle,
      albumTitle: item.albumTitle,
      itemCount: 0,
      sourceItems: [],
      items: []
    };
    existing.itemCount += 1;
    existing.sourceItems.push({
      sourcePath: item.sourcePath,
      supported: item.supported
    });
    const historicalState = itemStateBySourcePath.get(item.sourcePath);
    existing.items.push({
      relativePath: item.relativePath,
      sizeBytes: item.sizeBytes,
      supported: item.supported,
      id: historicalState?.id ?? null,
      jobId: historicalState?.jobId ?? null,
      status: historicalState?.status,
      lastError: historicalState?.lastError ?? null
    });
    albumMap.set(item.albumTitle, existing);
  }

  return {
    account: {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      expiresAt: account.expiresAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastConnectedAt: account.lastConnectedAt
    },
    albums: [...albumMap.values()]
      .sort((left, right) => left.albumTitle.localeCompare(right.albumTitle))
      .map((album) => ({
        folderName: album.folderName,
        albumTitle: album.albumTitle,
        itemCount: album.itemCount,
        items: album.items,
        status: getCachedGooglePhotosAlbumByTitle(accountId, album.albumTitle) ? 'existing' : 'new',
        uploadStatus: isGooglePhotosAlbumCompleted(album.sourceItems, completedSourcePaths) ? 'completed' : 'pending'
      })),
    supportedItems: supportedItems.length,
    unsupportedItems: plannedItems.length - supportedItems.length
  };
};

export const listRunnableExportItems = (jobId: string) => {
  runMigrations();
  const db = getDb();

  return db
    .prepare(
      `
        SELECT *
        FROM export_items
        WHERE job_id = ?
          AND status IN ('pending', 'running')
        ORDER BY relative_path ASC
      `
    )
    .all(jobId) as Array<Parameters<typeof toItemRecord>[0]>;
};

export const resetRunningExportItems = (jobId: string) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE export_items
      SET status = 'pending',
          last_error = NULL,
          updated_at = ?
      WHERE job_id = ? AND status = 'running'
    `
  ).run(timestamp, jobId);
};

export const resetInvalidCompletedExportItems = (jobId: string, isCompletedOutputValid: (item: ExportItemRecord) => boolean) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM export_items
        WHERE job_id = ?
          AND status IN ('completed', 'skipped')
      `
    )
    .all(jobId) as Array<Parameters<typeof toItemRecord>[0]>;

  for (const row of rows) {
    const item = toItemRecord(row);

    if (isCompletedOutputValid(item)) {
      continue;
    }

    db.prepare(
      `
        UPDATE export_items
        SET status = 'pending',
            last_error = NULL,
            updated_at = ?
        WHERE id = ?
      `
    ).run(timestamp, item.id);
  }
};

export const getExportJobStatus = (jobId: string) => {
  const db = getDb();
  const row = db.prepare('SELECT status FROM export_jobs WHERE id = ?').get(jobId) as { status: ExportJobRecord['status'] } | undefined;
  return row?.status ?? null;
};

export const persistExportItemResult = (
  itemId: string,
  status: ExportItemRecord['status'],
  lastError: string | null,
  cursor: string | null
) => {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE export_items
      SET status = ?,
          attempt_count = attempt_count + 1,
          last_error = ?,
          updated_at = ?
      WHERE id = ?
    `
  ).run(status, lastError, timestamp, itemId);

  const row = db.prepare('SELECT job_id FROM export_items WHERE id = ?').get(itemId) as { job_id: string } | undefined;

  if (row) {
    db.prepare(
      `
        UPDATE export_checkpoints
        SET cursor = ?, updated_at = ?
        WHERE job_id = ?
      `
    ).run(cursor, timestamp, row.job_id);
  }
};

export const markExportItemRunning = (itemId: string, cursor: string | null) => {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE export_items
      SET status = 'running',
          last_error = NULL,
          updated_at = ?
      WHERE id = ?
    `
  ).run(timestamp, itemId);

  const row = db.prepare('SELECT job_id FROM export_items WHERE id = ?').get(itemId) as { job_id: string } | undefined;

  if (row) {
    db.prepare(
      `
        UPDATE export_checkpoints
        SET cursor = ?, updated_at = ?
        WHERE job_id = ?
      `
    ).run(cursor, timestamp, row.job_id);
  }
};

export const refreshExportJobCounters = (jobId: string, statusOverride?: ExportJobRecord['status']) => {
  const db = getDb();
  const timestamp = nowIso();
  const currentStatus = getExportJobStatus(jobId);
  const counts = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
        FROM export_items
        WHERE job_id = ?
      `
    )
    .get(jobId) as {
      total: number;
      completed: number | null;
      failed: number | null;
      skipped: number | null;
      pending: number | null;
      running: number | null;
    };

  const completed = counts.completed ?? 0;
  const failed = counts.failed ?? 0;
  const skipped = counts.skipped ?? 0;
  const pending = counts.pending ?? 0;
  const running = counts.running ?? 0;
  const hasWorkLeft = pending + running > 0;
  const derivedStatus = hasWorkLeft ? 'running' : failed > 0 ? 'failed' : completed + skipped >= counts.total ? 'completed' : 'running';
  const effectiveOverride = statusOverride === 'paused' && !hasWorkLeft ? undefined : statusOverride;
  const nextStatus = effectiveOverride
    ?? (currentStatus === 'cancelled'
      ? 'cancelled'
      : currentStatus === 'paused' && hasWorkLeft
        ? 'paused'
        : derivedStatus);

  db.prepare(
    `
      UPDATE export_jobs
      SET status = ?,
          total_items = ?,
          completed_items = ?,
          failed_items = ?,
          skipped_items = ?,
          updated_at = ?,
          last_opened_at = ?
      WHERE id = ?
    `
  ).run(nextStatus, counts.total, completed, failed, skipped, timestamp, timestamp, jobId);

  return getExportJob(jobId);
};
