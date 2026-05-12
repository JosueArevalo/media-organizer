import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import type { JobRecord, JobCheckpointRecord } from '../../state/dto/state.types.js';
import {
  buildCompressionImagesOutputDir,
  buildCompressionJobManifestPath,
  buildCompressionJobOutputRoot,
  buildCompressionVideosOutputDir
} from './compressionJob.paths.js';
import { resolveToolCommand } from './toolCommandResolver.js';

export type CompressionJobRequest = {
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

export type CompressionJobManifest = {
  jobId: string;
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

export type CompressionJobLaunchResult = {
  job: JobRecord;
  checkpoint: JobCheckpointRecord;
  manifest: CompressionJobManifest;
  outputRoot: string;
  manifestPath: string;
};

const nowIso = () => new Date().toISOString();

const ensureDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

const upsertJob = (request: CompressionJobRequest, jobId: string, timestamp: string): JobRecord => {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO jobs (id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_dir = excluded.source_dir,
        output_dir = excluded.output_dir,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_opened_at = excluded.last_opened_at
    `
  ).run(jobId, request.name ?? null, request.sourceDir, request.outputDir, timestamp, timestamp, timestamp);

  const job = db
    .prepare('SELECT id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at FROM jobs WHERE id = ?')
    .get(jobId) as {
    id: string;
    name: string | null;
    source_dir: string;
    output_dir: string;
    status: JobRecord['status'];
    created_at: string;
    updated_at: string;
    last_opened_at: string | null;
  };

  return {
    id: job.id,
    name: job.name,
    sourceDir: job.source_dir,
    outputDir: job.output_dir,
    status: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    lastOpenedAt: job.last_opened_at
  };
};

const upsertCompressionCheckpoint = (jobId: string, outputRoot: string, manifest: CompressionJobManifest, timestamp: string) => {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO job_checkpoints (id, job_id, stage, cursor, payload_json, updated_at)
      VALUES (?, ?, 'compress', NULL, ?, ?)
      ON CONFLICT(job_id, stage) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), jobId, JSON.stringify({ outputRoot, manifest }), timestamp);

  return db
    .prepare('SELECT id, job_id, stage, cursor, payload_json, updated_at FROM job_checkpoints WHERE job_id = ? AND stage = ?')
    .get(jobId, 'compress') as {
    id: string;
    job_id: string;
    stage: JobCheckpointRecord['stage'];
    cursor: string | null;
    payload_json: string | null;
    updated_at: string;
  };
};

export const startCompressionJob = (request: CompressionJobRequest): CompressionJobLaunchResult => {
  runMigrations();

  const jobId = randomUUID();
  const timestamp = nowIso();
  const outputRoot = buildCompressionJobOutputRoot(request.outputDir, jobId);
  const imageOutputDir = buildCompressionImagesOutputDir(outputRoot);
  const videoOutputDir = buildCompressionVideosOutputDir(outputRoot);
  const manifestPath = buildCompressionJobManifestPath(outputRoot);
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
  const manifest: CompressionJobManifest = {
    jobId,
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

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const job = upsertJob(request, jobId, timestamp);
  const checkpointRow = upsertCompressionCheckpoint(jobId, outputRoot, manifest, timestamp);

  const checkpoint: JobCheckpointRecord = {
    id: checkpointRow.id,
    jobId: checkpointRow.job_id,
    stage: checkpointRow.stage,
    cursor: checkpointRow.cursor,
    payloadJson: checkpointRow.payload_json,
    updatedAt: checkpointRow.updated_at
  };

  return {
    job,
    checkpoint,
    manifest,
    outputRoot,
    manifestPath
  };
};

export const getCompressionJob = (jobId: string) => {
  runMigrations();
  const db = getDb();

  const job = db
    .prepare('SELECT id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at FROM jobs WHERE id = ?')
    .get(jobId) as
    | {
        id: string;
        name: string | null;
        source_dir: string;
        output_dir: string;
        status: JobRecord['status'];
        created_at: string;
        updated_at: string;
        last_opened_at: string | null;
      }
    | undefined;

  if (!job) {
    return null;
  }

  const checkpointRow = db
    .prepare('SELECT id, job_id, stage, cursor, payload_json, updated_at FROM job_checkpoints WHERE job_id = ? AND stage = ?')
    .get(jobId, 'compress') as
    | {
        id: string;
        job_id: string;
        stage: JobCheckpointRecord['stage'];
        cursor: string | null;
        payload_json: string | null;
        updated_at: string;
      }
    | undefined;

  return {
    job: {
      id: job.id,
      name: job.name,
      sourceDir: job.source_dir,
      outputDir: job.output_dir,
      status: job.status,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      lastOpenedAt: job.last_opened_at
    },
    checkpoint: checkpointRow
      ? {
          id: checkpointRow.id,
          jobId: checkpointRow.job_id,
          stage: checkpointRow.stage,
          cursor: checkpointRow.cursor,
          payloadJson: checkpointRow.payload_json,
          updatedAt: checkpointRow.updated_at
        }
      : null
  };
};