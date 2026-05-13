import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
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
  const resolvedImageCommand = resolveToolCommand(imageCommandFromRequest) ?? imageCommandFromRequest;
  const resolvedVideoCommand = resolveToolCommand(videoCommandFromRequest) ?? videoCommandFromRequest;
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
    selectionScope,
    createdAt: timestamp
  };

  ensureDirectory(imageOutputDir);
  ensureDirectory(videoOutputDir);
  ensureDirectory(path.dirname(manifestPath));

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const session = upsertSession(request, sessionId, timestamp);
  const checkpointRow = upsertCompressionCheckpoint(sessionId, outputRoot, manifest, timestamp);

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