import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import { upsertExecutionHistory } from '../../dashboard/dashboard.service.js';
import type { SessionRecord, SessionCheckpointRecord } from '../../state/dto/state.types.js';
import {
  buildCompressionImagesOutputDir,
  buildCompressionSessionManifestPath,
  buildCompressionSessionOutputRoot,
  buildCompressionVideosOutputDir
} from './compressionJob.paths.js';
import { resolveToolCommand } from './toolCommandResolver.js';

export type CompressionSessionRequest = {
  name?: string;
  sourceDir: string;
  outputDir: string;
  imageQuality: number;
  imageProfileLabel: string;
  videoPresetLabel: string;
  videoOutputFormatMode?: 'preserve' | 'mp4';
  imageToolCommand?: string;
  videoToolCommand?: string;
  imageMagickCommand?: string;
  exifToolCommand?: string;
  selectionScope?: {
    excludedDirectories: string[];
    excludedFiles: string[];
    includedDirectories: string[];
    includedFiles: string[];
    updatedAt: number;
  };
};

export type CompressionSessionManifest = {
  sessionId: string;
  sourceDir: string;
  outputDir: string;
  outputRoot: string;
  imageOutputDir: string;
  videoOutputDir: string;
  imageQuality: number;
  imageProfileLabel: string;
  videoPresetLabel: string;
  videoOutputFormatMode: 'preserve' | 'mp4';
  imageToolCommand: string;
  videoToolCommand: string;
  imageMagickCommand: string;
  exifToolCommand: string;
  selectionScope: {
    excludedDirectories: string[];
    excludedFiles: string[];
    includedDirectories: string[];
    includedFiles: string[];
    updatedAt: number;
  };
  createdAt: string;
};

export type CompressionSessionLaunchResult = {
  session: SessionRecord;
  checkpoint: SessionCheckpointRecord;
  manifest: CompressionSessionManifest;
  outputRoot: string;
  manifestPath: string;
};

type CompressionCheckpointPayload = {
  outputRoot?: string;
  manifest?: Partial<CompressionSessionManifest>;
  totalCount?: number;
  summary?: {
    completedItems?: number;
    failedItems?: number;
    totalCompressCount?: number;
    totalCopyCount?: number;
    completedCompressCount?: number;
    completedCopyCount?: number;
    failedCompressCount?: number;
    failedCopyCount?: number;
    retainedOriginalBecauseLargerCount?: number;
  };
  activeItems?: unknown[];
  processedItems?: unknown[];
  interrupted?: boolean;
  interruptedAt?: string;
  fatalError?: string;
};

const nowIso = () => new Date().toISOString();

const ensureDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

const upsertSession = (request: CompressionSessionRequest, sessionId: string, timestamp: string): SessionRecord => {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO sessions (id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_dir = excluded.source_dir,
        output_dir = excluded.output_dir,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_opened_at = excluded.last_opened_at
    `
  ).run(sessionId, request.name ?? null, request.sourceDir, request.outputDir, timestamp, timestamp, timestamp);

  const session = db
    .prepare('SELECT id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at FROM sessions WHERE id = ?')
    .get(sessionId) as {
    id: string;
    name: string | null;
    source_dir: string;
    output_dir: string;
    status: SessionRecord['status'];
    created_at: string;
    updated_at: string;
    last_opened_at: string | null;
  };

  return {
    id: session.id,
    name: session.name,
    sourceDir: session.source_dir,
    outputDir: session.output_dir,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lastOpenedAt: session.last_opened_at
  };
};

const upsertCompressionCheckpoint = (sessionId: string, outputRoot: string, manifest: CompressionSessionManifest, timestamp: string) => {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO session_checkpoints (id, session_id, stage, cursor, payload_json, updated_at)
      VALUES (?, ?, 'compress', NULL, ?, ?)
      ON CONFLICT(session_id, stage) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), sessionId, JSON.stringify({ outputRoot, manifest }), timestamp);

  return db
    .prepare('SELECT id, session_id, stage, cursor, payload_json, updated_at FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'compress') as {
    id: string;
    session_id: string;
    stage: SessionCheckpointRecord['stage'];
    cursor: string | null;
    payload_json: string | null;
    updated_at: string;
  };
};

const parseCheckpointPayload = (payloadJson: string | null): CompressionCheckpointPayload => {
  if (!payloadJson) {
    return {};
  }

  try {
    return JSON.parse(payloadJson) as CompressionCheckpointPayload;
  } catch {
    return {};
  }
};

const serializeCheckpointPayload = (payload: CompressionCheckpointPayload) => JSON.stringify(payload);

export const startCompressionSession = (request: CompressionSessionRequest): CompressionSessionLaunchResult => {
  runMigrations();

  const sessionId = randomUUID();
  const timestamp = nowIso();
  const outputRoot = buildCompressionSessionOutputRoot(request.outputDir);
  const imageOutputDir = buildCompressionImagesOutputDir(outputRoot);
  const videoOutputDir = buildCompressionVideosOutputDir(outputRoot);
  const manifestPath = buildCompressionSessionManifestPath(outputRoot);
  const imageCommandFromRequest = request.imageToolCommand?.trim() || 'cjpeg';
  const videoCommandFromRequest = request.videoToolCommand?.trim() || 'HandBrakeCLI';
  const imageMagickCommandFromRequest = request.imageMagickCommand?.trim() || 'magick';
  const exifToolCommandFromRequest = request.exifToolCommand?.trim() || '';
  const resolvedImageCommand = resolveToolCommand(imageCommandFromRequest) ?? imageCommandFromRequest;
  const resolvedVideoCommand = resolveToolCommand(videoCommandFromRequest) ?? videoCommandFromRequest;
  const resolvedImageMagickCommand = resolveToolCommand(imageMagickCommandFromRequest) ?? imageMagickCommandFromRequest;
  const resolvedExifToolCommand = exifToolCommandFromRequest
    ? resolveToolCommand(exifToolCommandFromRequest) ?? exifToolCommandFromRequest
    : '';
  const selectionScope = request.selectionScope ?? {
    excludedDirectories: [],
    excludedFiles: [],
    includedDirectories: [],
    includedFiles: [],
    updatedAt: Date.now()
  };
  const manifest: CompressionSessionManifest = {
    sessionId,
    sourceDir: request.sourceDir,
    outputDir: request.outputDir,
    outputRoot,
    imageOutputDir,
    videoOutputDir,
    imageQuality: request.imageQuality,
    imageProfileLabel: request.imageProfileLabel,
    videoPresetLabel: request.videoPresetLabel,
    videoOutputFormatMode: request.videoOutputFormatMode === 'mp4' ? 'mp4' : 'preserve',
    imageToolCommand: resolvedImageCommand,
    videoToolCommand: resolvedVideoCommand,
    imageMagickCommand: resolvedImageMagickCommand,
    exifToolCommand: resolvedExifToolCommand,
    selectionScope,
    createdAt: timestamp
  };

  ensureDirectory(imageOutputDir);
  ensureDirectory(videoOutputDir);
  ensureDirectory(path.dirname(manifestPath));

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const session = upsertSession(request, sessionId, timestamp);
  const checkpointRow = upsertCompressionCheckpoint(sessionId, outputRoot, manifest, timestamp);

  upsertExecutionHistory({
    sessionId,
    name: session.name,
    sourceDir: session.sourceDir,
    outputDir: session.outputDir,
    outputRoot,
    status: 'running',
    startedAt: session.createdAt,
    finishedAt: null,
    updatedAt: session.updatedAt,
    totalItems: 0,
    imageItems: 0,
    videoItems: 0,
    completedItems: 0,
    failedItems: 0,
    imageProfileLabel: manifest.imageProfileLabel,
    imageQuality: manifest.imageQuality,
    videoPresetLabel: manifest.videoPresetLabel,
    errorSummary: []
  });

  const checkpoint: SessionCheckpointRecord = {
    id: checkpointRow.id,
    sessionId: checkpointRow.session_id,
    stage: checkpointRow.stage,
    cursor: checkpointRow.cursor,
    payloadJson: checkpointRow.payload_json,
    updatedAt: checkpointRow.updated_at
  };

  return {
    session,
    checkpoint,
    manifest,
    outputRoot,
    manifestPath
  };
};

export const getCompressionSession = (sessionId: string) => {
  runMigrations();
  const db = getDb();

  const session = db
    .prepare('SELECT id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at FROM sessions WHERE id = ?')
    .get(sessionId) as
    | {
        id: string;
        name: string | null;
        source_dir: string;
        output_dir: string;
        status: SessionRecord['status'];
        created_at: string;
        updated_at: string;
        last_opened_at: string | null;
      }
    | undefined;

  const checkpointRow = db
    .prepare('SELECT id, session_id, stage, cursor, payload_json, updated_at FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'compress') as
    | {
        id: string;
        session_id: string;
        stage: SessionCheckpointRecord['stage'];
        cursor: string | null;
        payload_json: string | null;
        updated_at: string;
      }
    | undefined;

  if (!session || !checkpointRow) {
    return null;
  }

  return {
    session: {
      id: session.id,
      name: session.name,
      sourceDir: session.source_dir,
      outputDir: session.output_dir,
      status: session.status,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      lastOpenedAt: session.last_opened_at
    },
    checkpoint: {
      id: checkpointRow.id,
      sessionId: checkpointRow.session_id,
      stage: checkpointRow.stage,
      cursor: checkpointRow.cursor,
      payloadJson: checkpointRow.payload_json,
      updatedAt: checkpointRow.updated_at
    }
  };
};

export const getActiveCompressionSession = () => {
  runMigrations();
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT s.id
        FROM sessions s
        JOIN session_checkpoints sc ON sc.session_id = s.id AND sc.stage = 'compress'
        WHERE s.status IN ('running', 'paused')
        ORDER BY datetime(s.updated_at) DESC
        LIMIT 1
      `
    )
    .get() as { id: string } | undefined;

  if (!row) {
    return null;
  }

  const snapshot = getCompressionSession(row.id);
  const progress = getCompressionProgress(row.id);

  if (!snapshot || !progress) {
    return null;
  }

  return {
    ...snapshot,
    progress
  };
};

export interface CompressionProgressData {
  sessionId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  currentlyProcessing: Array<{
    id: string;
    sourcePath: string;
    displayPath?: string;
    operation: 'compress' | 'copy';
    startedAt?: number;
  }>;
  processedItems: Array<{
    id: string;
    sourcePath: string;
    displayPath?: string;
    status: 'completed' | 'failed';
    error?: string;
    operation: 'compress' | 'copy';
    startedAt?: number;
    finishedAt?: number;
    durationMs?: number;
    skipped?: boolean;
    outcome?: 'original-retained-size';
    sourceBytes?: number;
    encodedBytes?: number;
  }>;
  totalCompress: number;
  totalCopy: number;
  completedCompress: number;
  completedCopy: number;
  failedCompress: number;
  failedCopy: number;
  retainedOriginalBecauseLarger: number;
}

const getSourceDisplayPath = (sourceDir: string | null, sourcePath: string) => {
  if (!sourceDir) {
    return sourcePath;
  }

  const relativePath = path.relative(sourceDir, sourcePath);
  const escapesSource = relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || relativePath.startsWith('../') || relativePath.startsWith('..\\');

  if (!relativePath || path.isAbsolute(relativePath) || escapesSource) {
    return sourcePath;
  }

  return relativePath.replace(/[\\/]+/g, '\\');
};

export const getCompressionProgress = (sessionId: string): CompressionProgressData | null => {
  runMigrations();
  const db = getDb();

  const session = db
    .prepare('SELECT id, status FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; status: string } | undefined;

  // Get total count from checkpoint
  const checkpoint = db
    .prepare('SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'compress') as { payload_json: string } | undefined;

  if (!session || !checkpoint) {
    return null;
  }

  let totalCount = 0;
  let checkpointCompletedCount: number | null = null;
  let checkpointFailedCount: number | null = null;
  let totalCompressCount = 0;
  let totalCopyCount = 0;
  let checkpointCompletedCompressCount: number | null = null;
  let checkpointCompletedCopyCount: number | null = null;
  let checkpointFailedCompressCount: number | null = null;
  let checkpointFailedCopyCount: number | null = null;
  let retainedOriginalBecauseLargerCount = 0;
  let manifestSourceDir: string | null = null;
  let activeItems: Array<{ id: string; sourcePath: string; displayPath?: string; operation: 'compress' | 'copy'; startedAt?: number }> = [];
  let checkpointProcessedItems: CompressionProgressData['processedItems'] = [];
  if (checkpoint?.payload_json) {
    try {
      const parsed = JSON.parse(checkpoint.payload_json);
      manifestSourceDir = typeof parsed.manifest?.sourceDir === 'string' ? parsed.manifest.sourceDir : null;
      totalCount = parsed.totalCount ?? 0;
      checkpointCompletedCount = parsed.summary?.completedItems ?? null;
      checkpointFailedCount = parsed.summary?.failedItems ?? null;
      totalCompressCount = parsed.summary?.totalCompressCount ?? 0;
      totalCopyCount = parsed.summary?.totalCopyCount ?? 0;
      checkpointCompletedCompressCount = parsed.summary?.completedCompressCount ?? null;
      checkpointCompletedCopyCount = parsed.summary?.completedCopyCount ?? null;
      checkpointFailedCompressCount = parsed.summary?.failedCompressCount ?? null;
      checkpointFailedCopyCount = parsed.summary?.failedCopyCount ?? null;
      retainedOriginalBecauseLargerCount = parsed.summary?.retainedOriginalBecauseLargerCount ?? 0;
      activeItems = Array.isArray(parsed.activeItems)
        ? parsed.activeItems
            .filter((item: { id?: unknown; sourcePath?: unknown; operation?: unknown }) =>
              typeof item.id === 'string' &&
              typeof item.sourcePath === 'string' &&
              (item.operation === 'compress' || item.operation === 'copy')
            )
            .map((item: { id: string; sourcePath: string; displayPath?: unknown; operation: 'compress' | 'copy'; startedAt?: unknown }) => ({
              id: item.id,
              sourcePath: item.sourcePath,
              displayPath: typeof item.displayPath === 'string' ? item.displayPath : getSourceDisplayPath(manifestSourceDir, item.sourcePath),
              operation: item.operation,
              ...(typeof item.startedAt === 'number' ? { startedAt: item.startedAt } : {})
            }))
        : [];
      checkpointProcessedItems = Array.isArray(parsed.processedItems)
        ? parsed.processedItems
            .filter((item: { source?: unknown; status?: unknown; operation?: unknown }) =>
              typeof item.source === 'string' &&
              (item.status === 'completed' || item.status === 'failed') &&
              (item.operation === 'compress' || item.operation === 'copy')
            )
            .map((item: {
              source: string;
              status: 'completed' | 'failed';
              displayPath?: unknown;
              error?: unknown;
              operation: 'compress' | 'copy';
              startedAt?: unknown;
              finishedAt?: unknown;
              durationMs?: unknown;
              skipped?: unknown;
              outcome?: unknown;
              sourceBytes?: unknown;
              encodedBytes?: unknown;
            }) => ({
              id: item.source,
              sourcePath: item.source,
              displayPath: typeof item.displayPath === 'string' ? item.displayPath : getSourceDisplayPath(manifestSourceDir, item.source),
              status: item.status,
              ...(typeof item.error === 'string' ? { error: item.error } : {}),
              operation: item.operation,
              ...(typeof item.startedAt === 'number' ? { startedAt: item.startedAt } : {}),
              ...(typeof item.finishedAt === 'number' ? { finishedAt: item.finishedAt } : {}),
              ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
              ...(typeof item.skipped === 'boolean' ? { skipped: item.skipped } : {}),
              ...(item.outcome === 'original-retained-size' ? { outcome: item.outcome } : {}),
              ...(typeof item.sourceBytes === 'number' ? { sourceBytes: item.sourceBytes } : {}),
              ...(typeof item.encodedBytes === 'number' ? { encodedBytes: item.encodedBytes } : {})
            }))
        : [];
    } catch (e) {
      // Invalid JSON, use 0
      console.warn(`[getCompressionProgress] Failed to parse checkpoint JSON:`, e);
    }
  }

  // Get all processed items (completed and failed)
  const allProcessedItems = db
    .prepare(
      `
      SELECT mi.id, mi.source_path, iss.status, iss.last_error
      , COALESCE(idc.selected_for_compression, 0) AS selected_for_compression
      FROM item_stage_status iss
      JOIN media_items mi ON iss.item_id = mi.id
      LEFT JOIN item_decisions idc ON idc.item_id = mi.id AND idc.session_id = iss.session_id
      WHERE iss.session_id = ? AND iss.stage = 'compress' AND iss.status IN ('completed', 'failed')
      ORDER BY iss.updated_at ASC
    `
    )
    .all(sessionId) as Array<{ id: string; source_path: string; status: string; last_error: string | null; selected_for_compression: number }>;

  // Get completed and failed counts
  let completedCount = 0;
  let failedCount = 0;
  let completedCompressCount = 0;
  let completedCopyCount = 0;
  let failedCompressCount = 0;
  let failedCopyCount = 0;

  for (const item of allProcessedItems) {
    const operation = item.selected_for_compression ? 'compress' : 'copy';

    if (item.status === 'completed') {
      completedCount += 1;

      if (operation === 'compress') {
        completedCompressCount += 1;
      } else {
        completedCopyCount += 1;
      }
    } else if (item.status === 'failed') {
      failedCount += 1;

      if (operation === 'compress') {
        failedCompressCount += 1;
      } else {
        failedCopyCount += 1;
      }
    }
  }

  if (checkpointCompletedCount !== null || checkpointFailedCount !== null) {
    completedCount = checkpointCompletedCount ?? completedCount;
    failedCount = checkpointFailedCount ?? failedCount;
  }

  completedCompressCount = checkpointCompletedCompressCount ?? completedCompressCount;
  completedCopyCount = checkpointCompletedCopyCount ?? completedCopyCount;
  failedCompressCount = checkpointFailedCompressCount ?? failedCompressCount;
  failedCopyCount = checkpointFailedCopyCount ?? failedCopyCount;

  if (totalCount > 0 && totalCompressCount === 0 && totalCopyCount === 0) {
    totalCompressCount = completedCompressCount + failedCompressCount;
    totalCopyCount = Math.max(0, totalCount - totalCompressCount);
  }

  const databaseProcessedItems = allProcessedItems.map((item) => ({
    id: item.id,
    sourcePath: item.source_path,
    displayPath: getSourceDisplayPath(manifestSourceDir, item.source_path),
    status: item.status as 'completed' | 'failed',
    ...(item.last_error ? { error: item.last_error } : {}),
    operation: item.selected_for_compression ? 'compress' as const : 'copy' as const
  }));

  return {
    sessionId,
    status: session.status,
    total: totalCount,
    completed: completedCount,
    failed: failedCount,
    currentlyProcessing: activeItems,
    processedItems: checkpointProcessedItems.length > 0 ? checkpointProcessedItems : databaseProcessedItems,
    totalCompress: totalCompressCount,
    totalCopy: totalCopyCount,
    completedCompress: completedCompressCount,
    completedCopy: completedCopyCount,
    failedCompress: failedCompressCount,
    failedCopy: failedCopyCount,
    retainedOriginalBecauseLarger: retainedOriginalBecauseLargerCount
  };
};

export const reconcileInterruptedCompressionSessions = () => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();
  const runningRows = db
    .prepare(
      `
        SELECT s.id, sc.payload_json
        FROM sessions s
        JOIN session_checkpoints sc ON sc.session_id = s.id AND sc.stage = 'compress'
        WHERE s.status = 'running'
      `
    )
    .all() as Array<{ id: string; payload_json: string | null }>;

  for (const row of runningRows) {
    const payload = parseCheckpointPayload(row.payload_json);

    db.prepare('UPDATE sessions SET status = ?, updated_at = ?, last_opened_at = ? WHERE id = ?').run(
      'paused',
      timestamp,
      timestamp,
      row.id
    );

    db.prepare(
      `
        UPDATE session_checkpoints
        SET payload_json = ?, updated_at = ?
        WHERE session_id = ? AND stage = 'compress'
      `
    ).run(
      serializeCheckpointPayload({
        ...payload,
        activeItems: [],
        interrupted: true,
        interruptedAt: timestamp
      }),
      timestamp,
      row.id
    );
  }

  return runningRows.length;
};

export const markCompressionSessionRunning = (sessionId: string) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();
  const snapshot = getCompressionSession(sessionId);

  if (!snapshot) {
    return null;
  }

  db.prepare('UPDATE sessions SET status = ?, updated_at = ?, last_opened_at = ? WHERE id = ?').run('running', timestamp, timestamp, sessionId);

  if (snapshot.checkpoint) {
    const payload = parseCheckpointPayload(snapshot.checkpoint.payloadJson);
    db.prepare(
      `
        UPDATE session_checkpoints
        SET payload_json = ?, updated_at = ?
        WHERE session_id = ? AND stage = 'compress'
      `
    ).run(
      serializeCheckpointPayload({
        ...payload,
        activeItems: [],
        interrupted: false
      }),
      timestamp,
      sessionId
    );
  }

  return getCompressionSession(sessionId);
};

export const startCompressionSessionResume = (sessionId: string) => {
  const snapshot = markCompressionSessionRunning(sessionId);

  if (!snapshot) {
    return null;
  }

  return {
    ...snapshot,
    progress: getCompressionProgress(sessionId),
    accepted: true
  };
};

export const markCompressionSessionFailed = (sessionId: string, error: Error) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();
  const snapshot = getCompressionSession(sessionId);

  if (!snapshot) {
    return null;
  }

  db.prepare('UPDATE sessions SET status = ?, updated_at = ?, last_opened_at = ? WHERE id = ?').run('failed', timestamp, timestamp, sessionId);

  const checkpointPayload = parseCheckpointPayload(snapshot.checkpoint?.payloadJson ?? null);

  if (snapshot.checkpoint) {
    db.prepare(
      `
        UPDATE session_checkpoints
        SET payload_json = ?, updated_at = ?
        WHERE session_id = ? AND stage = 'compress'
      `
    ).run(
      JSON.stringify({
        ...checkpointPayload,
        summary: {
          ...checkpointPayload.summary,
          completedItems: checkpointPayload.summary?.completedItems ?? 0,
          failedItems: Math.max(1, checkpointPayload.summary?.failedItems ?? 0)
        },
        activeItems: [],
        fatalError: error.message
      }),
      timestamp,
      sessionId
    );
  }

  upsertExecutionHistory({
    sessionId,
    name: snapshot.session.name,
    sourceDir: snapshot.session.sourceDir,
    outputDir: snapshot.session.outputDir,
    outputRoot: checkpointPayload.outputRoot ?? null,
    status: 'failed',
    startedAt: snapshot.session.createdAt,
    finishedAt: timestamp,
    updatedAt: timestamp,
    totalItems: checkpointPayload.totalCount ?? 0,
    imageItems: 0,
    videoItems: 0,
    completedItems: checkpointPayload.summary?.completedItems ?? 0,
    failedItems: Math.max(1, checkpointPayload.summary?.failedItems ?? 0),
    imageProfileLabel: checkpointPayload.manifest?.imageProfileLabel ?? null,
    imageQuality: checkpointPayload.manifest?.imageQuality ?? null,
    videoPresetLabel: checkpointPayload.manifest?.videoPresetLabel ?? null,
    errorSummary: [{ source: snapshot.session.sourceDir, error: error.message }]
  });

  return getCompressionSession(sessionId);
};
