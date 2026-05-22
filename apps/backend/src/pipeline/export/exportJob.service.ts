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
  NetworkCredentials
} from './export.types.js';
import {
  authenticateNetworkPath,
  getNetworkErrorMessage,
  markNetworkDestinationUsed
} from './networkDestination.service.js';

const nowIso = () => new Date().toISOString();

const INTERNAL_DIRECTORY_NAME = '.media-organizer';

const toJobRecord = (row: {
  id: string;
  name: string | null;
  source_root: string;
  target_type: ExportJobRecord['targetType'];
  target_path: string | null;
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

const assertNetworkFolderRequest = (request: ExportJobRequest) => {
  if (request.target.type !== 'network-folder') {
    throw new Error('Only network-folder export is available in this MVP.');
  }

  if (!fs.existsSync(request.sourceRoot) || !fs.statSync(request.sourceRoot).isDirectory()) {
    throw new Error('Export sourceRoot must be an existing directory.');
  }

  const resolvedSource = normalizeExistingPath(request.sourceRoot);
  const resolvedDestination = normalizeExistingPath(request.target.destinationPath);

  if (resolvedSource === resolvedDestination || isPathInside(resolvedSource, resolvedDestination)) {
    throw new Error('Export destination cannot be inside the source folder.');
  }
};

export const createExportJob = (request: ExportJobRequest): ExportJobSnapshot => {
  runMigrations();
  assertNetworkFolderRequest(request);

  const db = getDb();
  const timestamp = nowIso();
  const jobId = randomUUID();
  const targetPath = request.target.type === 'network-folder' ? request.target.destinationPath : null;
  const plannedItems = request.target.type === 'network-folder'
    ? collectExportFilePlan(request.sourceRoot, request.target.destinationPath)
    : [];

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
          status,
          total_items,
          completed_items,
          failed_items,
          skipped_items,
          last_error,
          created_at,
          updated_at,
          last_opened_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', ?, 0, 0, 0, NULL, ?, ?, ?)
      `
    ).run(
      jobId,
      request.name ?? null,
      request.sourceRoot,
      request.target.type,
      targetPath,
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

    for (const item of plannedItems) {
      insertItem.run(randomUUID(), jobId, item.sourcePath, item.relativePath, item.destinationPath, item.sizeBytes, timestamp);
    }

    db.prepare(
      `
        INSERT INTO export_checkpoints (id, job_id, cursor, payload_json, updated_at)
        VALUES (?, ?, NULL, ?, ?)
      `
    ).run(randomUUID(), jobId, JSON.stringify({ target: request.target }), timestamp);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getExportJob(jobId) as ExportJobSnapshot;
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

export const getExportProgress = (jobId: string): ExportProgressData | null => {
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    return null;
  }

  return {
    jobId,
    status: snapshot.job.status,
    total: snapshot.job.totalItems,
    completed: snapshot.job.completedItems,
    failed: snapshot.job.failedItems,
    skipped: snapshot.job.skippedItems,
    pending: Math.max(0, snapshot.job.totalItems - snapshot.job.completedItems - snapshot.job.failedItems - snapshot.job.skippedItems),
    recentItems: snapshot.recentItems
  };
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

export const pauseExportJob = (jobId: string) => updateExportJobStatus(jobId, 'paused');

export const markExportJobRunning = (jobId: string) => updateExportJobStatus(jobId, 'running');

export const markExportJobFailed = (jobId: string, error: Error) => updateExportJobStatus(jobId, 'failed', error.message);

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
      WHERE job_id = ? AND status = 'failed'
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

export const testExportTarget = async (target: ExportTarget, credentials?: NetworkCredentials): Promise<ExportTargetTestResult> => {
  if (target.type === 'google-photos') {
    return {
      ok: false,
      targetType: target.type,
      message: 'Google Photos is prepared as a spike only and is not enabled in the MVP UI.',
      details: null,
      requiresAuthentication: false
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

    fs.mkdirSync(target.destinationPath, { recursive: true });
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

export const listRunnableExportItems = (jobId: string) => {
  runMigrations();
  const db = getDb();

  return db
    .prepare(
      `
        SELECT *
        FROM export_items
        WHERE job_id = ?
          AND status IN ('pending', 'failed', 'running')
        ORDER BY relative_path ASC
      `
    )
    .all(jobId) as Array<Parameters<typeof toItemRecord>[0]>;
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

export const refreshExportJobCounters = (jobId: string, statusOverride?: ExportJobRecord['status']) => {
  const db = getDb();
  const timestamp = nowIso();
  const counts = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
        FROM export_items
        WHERE job_id = ?
      `
    )
    .get(jobId) as { total: number; completed: number | null; failed: number | null; skipped: number | null };

  const completed = counts.completed ?? 0;
  const failed = counts.failed ?? 0;
  const skipped = counts.skipped ?? 0;
  const nextStatus = statusOverride ?? (failed > 0 ? 'failed' : completed + skipped >= counts.total ? 'completed' : 'running');

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
