import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { getDb } from '../../state/db.js';
import type { MediaType } from '../../state/dto/state.types.js';
import { buildImageCompressionCommand, buildVideoCompressionCommand } from './compressionCommandBuilder.js';
import { getCompressionJob } from './compressionJob.service.js';

type ScriptResultItem = {
  source: string;
  output: string;
  command: string[];
  status: 'completed' | 'failed';
  error?: string;
};

type ScriptResultPayload = {
  items: ScriptResultItem[];
};

const executeCommand = async (command: string, args: string[]): Promise<ScriptResultPayload> => {
  return await new Promise<ScriptResultPayload>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on('error', reject);

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

      if (!stdout) {
        if (code === 0) {
          resolve({ items: [] });
          return;
        }

        reject(new Error(`Compression script failed with code ${code}: ${stderr || 'No output provided.'}`));
        return;
      }

      try {
        const payload = JSON.parse(stdout) as ScriptResultPayload;

        if (!payload || !Array.isArray(payload.items)) {
          throw new Error('Invalid payload shape.');
        }

        resolve(payload);
      } catch (error) {
        reject(new Error(`Could not parse compression script output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
};

const getMediaTypeFromPath = (filePath: string): MediaType => {
  const extension = path.extname(filePath).toLowerCase();

  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif'].includes(extension)) {
    return 'image';
  }

  if (['.mp4', '.mov', '.m4v', '.avi', '.mkv'].includes(extension)) {
    return 'video';
  }

  return 'unknown';
};

const parseManifestFromCheckpoint = (payloadJson: string | null) => {
  if (!payloadJson) {
    return null;
  }

  try {
    return JSON.parse(payloadJson) as {
      outputRoot: string;
      manifest: {
        sourceDir: string;
        imageOutputDir: string;
        videoOutputDir: string;
        imageQuality: number;
        imageProfileLabel: string;
        videoPresetLabel: string;
        imageToolCommand: string;
        videoToolCommand: string;
      };
    };
  } catch {
    return null;
  }
};

const upsertMediaItem = (jobId: string, sourcePath: string, sourceDir: string, outputPath: string) => {
  const db = getDb();
  const now = new Date().toISOString();
  const relativePath = path.relative(sourceDir, sourcePath) || path.basename(sourcePath);
  const mediaType = getMediaTypeFromPath(sourcePath);
  const sizeBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;

  db.prepare(
    `
      INSERT INTO media_items (
        id,
        job_id,
        source_path,
        relative_path,
        media_type,
        source_kind_detected,
        source_kind_override,
        size_bytes,
        capture_time,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'unknown', NULL, ?, NULL, ?, ?)
      ON CONFLICT(job_id, source_path) DO UPDATE SET
        relative_path = excluded.relative_path,
        media_type = excluded.media_type,
        size_bytes = excluded.size_bytes,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), jobId, sourcePath, relativePath, mediaType, sizeBytes, now, now);

  const row = db
    .prepare('SELECT id FROM media_items WHERE job_id = ? AND source_path = ?')
    .get(jobId, sourcePath) as { id: string };

  return row.id;
};

const upsertDecision = (jobId: string, itemId: string) => {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO item_decisions (
        id,
        job_id,
        item_id,
        selected_for_compression,
        selected_for_output,
        target_group_label,
        user_overridden,
        updated_at
      ) VALUES (?, ?, ?, 1, 1, NULL, 0, ?)
      ON CONFLICT(job_id, item_id) DO UPDATE SET
        selected_for_compression = excluded.selected_for_compression,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), jobId, itemId, now);
};

const upsertStageStatus = (jobId: string, itemId: string, status: 'completed' | 'failed', errorMessage: string | null) => {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO item_stage_status (
        id,
        job_id,
        item_id,
        stage,
        status,
        attempt_count,
        last_error,
        updated_at
      ) VALUES (?, ?, ?, 'compress', ?, 1, ?, ?)
      ON CONFLICT(job_id, item_id, stage) DO UPDATE SET
        status = excluded.status,
        attempt_count = item_stage_status.attempt_count + 1,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), jobId, itemId, status, errorMessage, now);
};

const updateJobAndCheckpoint = (
  jobId: string,
  payload: {
    image: ScriptResultPayload;
    video: ScriptResultPayload;
    outputRoot: string;
    failedCount: number;
    completedCount: number;
  }
) => {
  const db = getDb();
  const now = new Date().toISOString();
  const nextStatus = payload.failedCount > 0 ? 'failed' : 'completed';

  db.prepare('UPDATE jobs SET status = ?, updated_at = ?, last_opened_at = ? WHERE id = ?').run(nextStatus, now, now, jobId);

  db.prepare(
    `
      UPDATE job_checkpoints
      SET payload_json = ?, updated_at = ?
      WHERE job_id = ? AND stage = 'compress'
    `
  ).run(
    JSON.stringify({
      outputRoot: payload.outputRoot,
      summary: {
        completedItems: payload.completedCount,
        failedItems: payload.failedCount
      },
      image: payload.image,
      video: payload.video
    }),
    now,
    jobId
  );
};

export const executeCompressionJob = async (jobId: string) => {
  const snapshot = getCompressionJob(jobId);

  if (!snapshot?.checkpoint) {
    throw new Error('Compression checkpoint not found for job.');
  }

  const checkpointData = parseManifestFromCheckpoint(snapshot.checkpoint.payloadJson);

  if (!checkpointData) {
    throw new Error('Compression manifest data is missing or malformed.');
  }

  const imageCommand = buildImageCompressionCommand({
    jobId,
    sourceDir: checkpointData.manifest.sourceDir,
    outputDir: snapshot.job.outputDir,
    outputRoot: checkpointData.outputRoot,
    imageOutputDir: checkpointData.manifest.imageOutputDir,
    videoOutputDir: checkpointData.manifest.videoOutputDir,
    imageQuality: checkpointData.manifest.imageQuality,
    imageProfileLabel: checkpointData.manifest.imageProfileLabel,
    videoPresetLabel: checkpointData.manifest.videoPresetLabel,
    imageToolCommand: checkpointData.manifest.imageToolCommand,
    videoToolCommand: checkpointData.manifest.videoToolCommand,
    createdAt: snapshot.job.createdAt
  });

  const videoCommand = buildVideoCompressionCommand({
    jobId,
    sourceDir: checkpointData.manifest.sourceDir,
    outputDir: snapshot.job.outputDir,
    outputRoot: checkpointData.outputRoot,
    imageOutputDir: checkpointData.manifest.imageOutputDir,
    videoOutputDir: checkpointData.manifest.videoOutputDir,
    imageQuality: checkpointData.manifest.imageQuality,
    imageProfileLabel: checkpointData.manifest.imageProfileLabel,
    videoPresetLabel: checkpointData.manifest.videoPresetLabel,
    imageToolCommand: checkpointData.manifest.imageToolCommand,
    videoToolCommand: checkpointData.manifest.videoToolCommand,
    createdAt: snapshot.job.createdAt
  });

  const imageResult = await executeCommand(imageCommand.command, imageCommand.args);
  const videoResult = await executeCommand(videoCommand.command, videoCommand.args);
  const allItems = [...imageResult.items, ...videoResult.items];

  let completedCount = 0;
  let failedCount = 0;

  for (const item of allItems) {
    const itemId = upsertMediaItem(jobId, item.source, checkpointData.manifest.sourceDir, item.output);
    upsertDecision(jobId, itemId);
    upsertStageStatus(jobId, itemId, item.status, item.error ?? null);

    if (item.status === 'completed') {
      completedCount += 1;
    } else {
      failedCount += 1;
    }
  }

  updateJobAndCheckpoint(jobId, {
    image: imageResult,
    video: videoResult,
    outputRoot: checkpointData.outputRoot,
    completedCount,
    failedCount
  });

  return {
    jobId,
    completedCount,
    failedCount
  };
};