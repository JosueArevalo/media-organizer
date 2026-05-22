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

  if (!session) {
    return null;
  }

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
    checkpoint: checkpointRow
      ? {
          id: checkpointRow.id,
          sessionId: checkpointRow.session_id,
          stage: checkpointRow.stage,
          cursor: checkpointRow.cursor,
          payloadJson: checkpointRow.payload_json,
          updatedAt: checkpointRow.updated_at
        }
      : null
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
  }>;
  processedItems: Array<{
    id: string;
    sourcePath: string;
    status: 'completed' | 'failed';
  }>;
}

export const getCompressionProgress = (sessionId: string): CompressionProgressData | null => {
  runMigrations();
  const db = getDb();

  const session = db
    .prepare('SELECT id, status FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; status: string } | undefined;

  if (!session) {
    return null;
  }

  // Get total count from checkpoint
  const checkpoint = db
    .prepare('SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'compress') as { payload_json: string } | undefined;

  let totalCount = 0;
  let checkpointCompletedCount: number | null = null;
  let checkpointFailedCount: number | null = null;
  if (checkpoint?.payload_json) {
    try {
      const parsed = JSON.parse(checkpoint.payload_json);
      totalCount = parsed.totalCount ?? 0;
      checkpointCompletedCount = parsed.summary?.completedItems ?? null;
      checkpointFailedCount = parsed.summary?.failedItems ?? null;
      console.log(`[getCompressionProgress] sessionId=${sessionId} totalCount=${totalCount}`);
      console.log(`[getCompressionProgress] checkpoint payload keys:`, Object.keys(parsed));
    } catch (e) {
      // Invalid JSON, use 0
      console.log(`[getCompressionProgress] Failed to parse checkpoint JSON:`, e);
    }
  } else {
    console.log(`[getCompressionProgress] No checkpoint found for sessionId=${sessionId}`);
  }

  // Get all processed items (completed and failed)
  const allProcessedItems = db
    .prepare(
      `
      SELECT mi.id, mi.source_path, iss.status
      FROM item_stage_status iss
      JOIN media_items mi ON iss.item_id = mi.id
      WHERE iss.session_id = ? AND iss.stage = 'compress' AND iss.status IN ('completed', 'failed')
      ORDER BY iss.updated_at ASC
    `
    )
    .all(sessionId) as Array<{ id: string; source_path: string; status: string }>;

  // Get completed and failed counts
  let completedCount = 0;
  let failedCount = 0;

  for (const item of allProcessedItems) {
    if (item.status === 'completed') {
      completedCount += 1;
    } else if (item.status === 'failed') {
      failedCount += 1;
    }
  }

  if (checkpointCompletedCount !== null || checkpointFailedCount !== null) {
    completedCount = checkpointCompletedCount ?? completedCount;
    failedCount = checkpointFailedCount ?? failedCount;
  }

  // Get a few recently processed items for "currently processing" display (most recent)
  const recentItems = db
    .prepare(
      `
      SELECT mi.id, mi.source_path
      FROM item_stage_status iss
      JOIN media_items mi ON iss.item_id = mi.id
      WHERE iss.session_id = ? AND iss.stage = 'compress'
      ORDER BY iss.updated_at DESC
      LIMIT 3
    `
    )
    .all(sessionId) as Array<{ id: string; source_path: string }>;

  return {
    sessionId,
    status: session.status,
    total: totalCount,
    completed: completedCount,
    failed: failedCount,
    currentlyProcessing: recentItems.map((item) => ({
      id: item.id,
      sourcePath: item.source_path
    })),
    processedItems: allProcessedItems.map((item) => ({
      id: item.id,
      sourcePath: item.source_path,
      status: item.status as 'completed' | 'failed'
    }))
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

  const checkpointPayload = snapshot.checkpoint?.payloadJson
    ? (() => {
        try {
          return JSON.parse(snapshot.checkpoint?.payloadJson ?? '{}') as {
            outputRoot?: string;
            manifest?: {
              imageProfileLabel?: string;
              videoPresetLabel?: string;
            };
            totalCount?: number;
            summary?: {
              completedItems?: number;
              failedItems?: number;
            };
          };
        } catch {
          return {};
        }
      })()
    : {};

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
          completedItems: checkpointPayload.summary?.completedItems ?? 0,
          failedItems: Math.max(1, checkpointPayload.summary?.failedItems ?? 0)
        },
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
    videoPresetLabel: checkpointPayload.manifest?.videoPresetLabel ?? null,
    errorSummary: [{ source: snapshot.session.sourceDir, error: error.message }]
  });

  return getCompressionSession(sessionId);
};
