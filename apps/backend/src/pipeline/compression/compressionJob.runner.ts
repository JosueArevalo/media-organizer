import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { getDb } from '../../state/db.js';
import type { MediaType } from '../../state/dto/state.types.js';
import { upsertExecutionHistory } from '../../dashboard/dashboard.service.js';
import { buildImageCompressionCommand, buildVideoCompressionCommand } from './compressionCommandBuilder.js';
import { getCompressionSession } from './compressionJob.service.js';
import {
  clearCompressionPauseRequest,
  isCompressionPauseRequested,
  registerCompressionProcess,
  unregisterCompressionProcess
} from './compressionProcessRegistry.js';
import {
  closeCompressionTimingSegment,
  getCompressionTimingSnapshot,
  normalizeCompressionTiming,
  type CompressionTiming
} from './compressionTiming.js';

type ScriptResultItem = {
  source: string;
  output: string;
  command: string[];
  status: 'completed' | 'failed';
  displayPath?: string;
  operation?: 'compress' | 'copy';
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  skipped?: boolean;
  error?: string;
  warning?: string;
  outcome?: 'original-retained-size';
  sourceBytes?: number;
  encodedBytes?: number;
};

type ScriptActiveItem = {
  source: string;
  output: string;
  command: string[];
  operation?: 'compress' | 'copy';
  startedAt?: number;
};

type ScriptResultPayload = {
  items: ScriptResultItem[];
  paused?: boolean;
};

type ScriptProgressEvent = {
  type: 'start' | 'item' | 'complete';
  item?: ScriptActiveItem | ScriptResultItem;
  items?: ScriptResultItem[];
};

type ActiveCompressionItem = {
  id: string;
  sourcePath: string;
  displayPath?: string;
  operation: 'compress' | 'copy';
  startedAt?: number;
};

type SelectionScope = {
  excludedDirectories: string[];
  excludedFiles: string[];
  includedDirectories: string[];
  includedFiles: string[];
  updatedAt: number;
};

type CompressionManifestData = {
  outputRoot: string;
  activeItems?: ActiveCompressionItem[];
  manifest: {
    sourceDir: string;
    outputDir?: string;
    imageOutputDir: string;
    videoOutputDir: string;
    imageQuality: number;
    imageProfileLabel: string;
    videoPresetLabel: string;
    videoOutputFormatMode?: 'preserve' | 'mp4';
    imageToolCommand: string;
    videoToolCommand: string;
    imageMagickCommand?: string;
    exifToolCommand?: string;
    selectionScope?: SelectionScope;
    createdAt?: string;
  };
  processedItems?: ScriptResultItem[];
  timing?: CompressionTiming;
};

type OperationCounts = {
  totalCompressCount: number;
  totalCopyCount: number;
  completedCompressCount: number;
  completedCopyCount: number;
  failedCompressCount: number;
  failedCopyCount: number;
  retainedOriginalBecauseLargerCount: number;
};

const getFileSize = (filePath: string) => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
};

const calculateCompletedSizeMetrics = (items: ScriptResultItem[]) => {
  const completedItems = items.filter((item) => item.status === 'completed');

  if (completedItems.length === 0) {
    return { originalBytes: null, finalBytes: null };
  }

  return completedItems.reduce<{ originalBytes: number; finalBytes: number }>(
    (totals, item) => ({
      originalBytes: totals.originalBytes + getFileSize(item.source),
      finalBytes: totals.finalBytes + getFileSize(item.output)
    }),
    { originalBytes: 0, finalBytes: 0 }
  );
};

const executeCommand = async (
  sessionId: string,
  command: string,
  args: string[],
  onStart?: (item: ScriptActiveItem) => void,
  onItem?: (item: ScriptResultItem) => void
): Promise<ScriptResultPayload> => {
  return await new Promise<ScriptResultPayload>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    registerCompressionProcess(sessionId, child);

    const stderrChunks: Buffer[] = [];
    const items: ScriptResultItem[] = [];

    const stdoutReader = readline.createInterface({ input: child.stdout });

    stdoutReader.on('line', (line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return;
      }

      try {
        const event = JSON.parse(trimmedLine) as ScriptProgressEvent;

        if (event.type === 'start' && event.item) {
          onStart?.(event.item as ScriptActiveItem);
          return;
        }

        if (event.type === 'item' && event.item) {
          const item = event.item as ScriptResultItem;
          items.push(item);
          onItem?.(item);
          return;
        }

        if (event.type === 'complete' && Array.isArray(event.items)) {
          items.length = 0;
          items.push(...event.items);
        }
      } catch {
        // Ignore non-JSON lines and keep stderr available for debugging.
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on('error', (error) => {
      unregisterCompressionProcess(sessionId, child);
      reject(error);
    });

    child.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      stdoutReader.close();
      unregisterCompressionProcess(sessionId, child);

      if (code !== 0) {
        if (isCompressionPauseRequested(sessionId)) {
          resolve({ items, paused: true });
          return;
        }

        reject(new Error(`Compression script failed with code ${code}: ${stderr || 'No output provided.'}`));
        return;
      }

      resolve({ items });
    });
  });
};

const normalizePath = (value: string) => path.resolve(value).replace(/\\/g, '/').toLowerCase();

const getSourceDisplayPath = (sourceDir: string, sourcePath: string) => {
  const relativePath = path.relative(sourceDir, sourcePath);
  const escapesSource = relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || relativePath.startsWith('../') || relativePath.startsWith('..\\');

  if (!relativePath || path.isAbsolute(relativePath) || escapesSource) {
    return sourcePath;
  }

  return relativePath.replace(/[\\/]+/g, '\\');
};

const enrichResultItemDisplayPath = (sourceDir: string, item: ScriptResultItem): ScriptResultItem => ({
  ...item,
  displayPath: item.displayPath ?? getSourceDisplayPath(sourceDir, item.source)
});

const resolveScopePath = (sourceDir: string, scopePath: string) => {
  const trimmed = scopePath.trim();

  if (!trimmed) {
    return normalizePath(sourceDir);
  }

  if (path.isAbsolute(trimmed)) {
    return normalizePath(trimmed);
  }

  const normalizedInput = trimmed.replace(/\\/g, '/').replace(/^\/+/, '');
  const sourceRootName = path.basename(sourceDir).replace(/\\/g, '/').toLowerCase();
  const segments = normalizedInput.split('/').filter(Boolean);

  if (segments[0]?.toLowerCase() === sourceRootName) {
    segments.shift();
  }

  return normalizePath(path.join(sourceDir, ...segments));
};

const resolveSelectionScope = (sourceDir: string, scope: SelectionScope) => ({
  excludedDirectories: scope.excludedDirectories.map((entry) => resolveScopePath(sourceDir, entry)),
  excludedFiles: scope.excludedFiles.map((entry) => resolveScopePath(sourceDir, entry)),
  includedDirectories: scope.includedDirectories.map((entry) => resolveScopePath(sourceDir, entry)),
  includedFiles: scope.includedFiles.map((entry) => resolveScopePath(sourceDir, entry)),
  updatedAt: scope.updatedAt
});

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
    return JSON.parse(payloadJson) as CompressionManifestData;
  } catch {
    return null;
  }
};

const parseCheckpointPayload = (payloadJson: string | null) => {
  if (!payloadJson) {
    return null;
  }

  try {
    return JSON.parse(payloadJson) as Partial<CompressionManifestData>;
  } catch {
    return null;
  }
};

const getPersistedCompressionTiming = (sessionId: string, fallbackStartedAt: string | null = null) => {
  const db = getDb();
  const row = db
    .prepare('SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'compress') as { payload_json: string | null } | undefined;
  const payload = parseCheckpointPayload(row?.payload_json ?? null);
  return normalizeCompressionTiming(payload?.timing, fallbackStartedAt);
};

const getTimingHistoryFields = (timing: CompressionTiming, timestamp: string, includeOpenSegment: boolean) => {
  const timingSnapshot = getCompressionTimingSnapshot(timing, timestamp, includeOpenSegment);

  return {
    compressionActiveDurationMs: timingSnapshot.durationMs,
    compressionActiveStartedAt: includeOpenSegment ? timingSnapshot.activeStartedAt : null
  };
};

const getSessionBasics = (sessionId: string) => {
  const db = getDb();
  return db
    .prepare('SELECT name, source_dir, output_dir, created_at FROM sessions WHERE id = ?')
    .get(sessionId) as { name: string | null; source_dir: string; output_dir: string; created_at: string } | undefined;
};

const getPersistedMediaCounts = (sessionId: string) => {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT
          SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) AS image_items,
          SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) AS video_items
        FROM media_items
        WHERE session_id = ?
      `
    )
    .get(sessionId) as { image_items: number | null; video_items: number | null };

  return {
    imageItems: row.image_items ?? 0,
    videoItems: row.video_items ?? 0
  };
};

const hasMatchingCopiedOutput = (sourcePath: string, outputPath: string) => {
  if (!fs.existsSync(sourcePath) || !fs.existsSync(outputPath)) {
    return false;
  }

  const sourceStats = fs.statSync(sourcePath);
  const outputStats = fs.statSync(outputPath);

  if (sourceStats.size !== outputStats.size) {
    return false;
  }

  return fs.readFileSync(sourcePath).equals(fs.readFileSync(outputPath));
};

const getResumeCompletedItems = (sessionId: string, outputRoot: string) => {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `
        SELECT
          mi.source_path,
          mi.relative_path,
          COALESCE(idc.selected_for_compression, 0) AS selected_for_compression
        FROM item_stage_status iss
        JOIN media_items mi ON mi.id = iss.item_id
        LEFT JOIN item_decisions idc ON idc.item_id = mi.id AND idc.session_id = iss.session_id
        WHERE iss.session_id = ?
          AND iss.stage = 'compress'
          AND iss.status = 'completed'
        ORDER BY mi.source_path ASC
      `
    )
    .all(sessionId) as Array<{ source_path: string; relative_path: string; selected_for_compression: number }>;

  const completedItems: ScriptResultItem[] = [];

  for (const row of rows) {
    const outputPath = path.join(outputRoot, row.relative_path);
    const operation = row.selected_for_compression ? 'compress' as const : 'copy' as const;
    const isValidCompletedOutput = operation === 'copy'
      ? hasMatchingCopiedOutput(row.source_path, outputPath)
      : fs.existsSync(outputPath);

    if (!isValidCompletedOutput) {
      db.prepare(
        `
          UPDATE item_stage_status
          SET status = 'pending',
              last_error = NULL,
              updated_at = ?
          WHERE session_id = ?
            AND stage = 'compress'
            AND item_id = (
              SELECT id FROM media_items WHERE session_id = ? AND source_path = ?
            )
        `
      ).run(now, sessionId, sessionId, row.source_path);
      continue;
    }

    completedItems.push({
      source: row.source_path,
      output: outputPath,
      command: [],
      status: 'completed',
      operation,
      skipped: true
    });
  }

  return completedItems;
};

const collectFailedItems = (...payloads: ScriptResultPayload[]) =>
  payloads
    .flatMap((payload) => payload.items)
    .filter((item) => item.status === 'failed')
    .map((item) => ({ source: item.source, error: item.error ?? null }));

const getOperationCounts = (counts: OperationCounts): OperationCounts => ({
  totalCompressCount: counts.totalCompressCount,
  totalCopyCount: counts.totalCopyCount,
  completedCompressCount: counts.completedCompressCount,
  completedCopyCount: counts.completedCopyCount,
  failedCompressCount: counts.failedCompressCount,
  failedCopyCount: counts.failedCopyCount,
  retainedOriginalBecauseLargerCount: counts.retainedOriginalBecauseLargerCount
});

const isUnderExcludedAncestor = (
  absolutePath: string,
  excludedDirectories: Set<string>,
  includedDirectories: Set<string>
) => {
  const normalized = normalizePath(absolutePath);
  const segments = normalized.split('/').filter(Boolean);
  let currentPath = '';
  let ancestorExcluded = false;

  for (let index = 0; index < segments.length - 1; index += 1) {
    currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];

    if (excludedDirectories.has(currentPath)) {
      ancestorExcluded = true;
    }

    if (ancestorExcluded && includedDirectories.has(currentPath)) {
      ancestorExcluded = false;
    }
  }

  return ancestorExcluded;
};

const isFileCompressed = (absolutePath: string, scope: SelectionScope) => {
  const normalizedPath = normalizePath(absolutePath);
  const excludedDirectories = new Set(scope.excludedDirectories.map(normalizePath));
  const includedDirectories = new Set(scope.includedDirectories.map(normalizePath));
  const excludedFiles = new Set(scope.excludedFiles.map(normalizePath));
  const includedFiles = new Set(scope.includedFiles.map(normalizePath));

  if (excludedFiles.has(normalizedPath)) {
    return false;
  }

  const ancestorExcluded = isUnderExcludedAncestor(absolutePath, excludedDirectories, includedDirectories);

  if (!ancestorExcluded) {
    return true;
  }

  return includedFiles.has(normalizedPath);
};

const upsertMediaItem = (sessionId: string, sourcePath: string, outputRoot: string, outputPath: string) => {
  const db = getDb();
  const now = new Date().toISOString();
  const relativePath = path.relative(outputRoot, outputPath) || path.basename(outputPath);
  const mediaType = getMediaTypeFromPath(sourcePath);
  const sizeBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;

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
      ) VALUES (?, ?, ?, ?, ?, 'unknown', NULL, ?, NULL, ?, ?)
      ON CONFLICT(session_id, source_path) DO UPDATE SET
        relative_path = excluded.relative_path,
        media_type = excluded.media_type,
        size_bytes = excluded.size_bytes,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), sessionId, sourcePath, relativePath, mediaType, sizeBytes, now, now);

  const row = db
    .prepare('SELECT id FROM media_items WHERE session_id = ? AND source_path = ?')
    .get(sessionId, sourcePath) as { id: string };

  return row.id;
};

const upsertDecision = (sessionId: string, itemId: string, selectedForCompression: boolean) => {
  const db = getDb();
  const now = new Date().toISOString();

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
      ) VALUES (?, ?, ?, ?, 1, NULL, 0, ?)
      ON CONFLICT(session_id, item_id) DO UPDATE SET
        selected_for_compression = excluded.selected_for_compression,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), sessionId, itemId, selectedForCompression ? 1 : 0, now);
};

const upsertStageStatus = (sessionId: string, itemId: string, status: 'completed' | 'failed', errorMessage: string | null) => {
  const db = getDb();
  const now = new Date().toISOString();

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
      ) VALUES (?, ?, ?, 'compress', ?, 1, ?, ?)
      ON CONFLICT(session_id, item_id, stage) DO UPDATE SET
        status = excluded.status,
        attempt_count = item_stage_status.attempt_count + 1,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), sessionId, itemId, status, errorMessage, now);
};

const isCompressOperation = (filePath: string, scope: SelectionScope) => {
  const extension = path.extname(filePath).toLowerCase();

  if (!isFileCompressed(filePath, scope)) {
    return false;
  }

  return ['.jpg', '.jpeg', '.heic', '.heif', '.mp4', '.mov', '.m4v', '.avi', '.mkv'].includes(extension);
};

const countFilesToProcess = (sourceDir: string, scope: SelectionScope): { totalCount: number } & Pick<OperationCounts, 'totalCompressCount' | 'totalCopyCount'> => {
  const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif']);
  const videoExtensions = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv']);
  let totalCount = 0;
  let totalCompressCount = 0;
  let totalCopyCount = 0;

  const walkDir = (dir: string, depth = 0): void => {
    if (depth > 50) return; // Prevent infinite recursion

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walkDir(fullPath, depth + 1);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (imageExtensions.has(ext) || videoExtensions.has(ext)) {
            totalCount += 1;

            if (isCompressOperation(fullPath, scope)) {
              totalCompressCount += 1;
            } else {
              totalCopyCount += 1;
            }
          }
        }
      }
    } catch {
      // Directory read error, skip
    }
  };

  walkDir(sourceDir);
  return { totalCount, totalCompressCount, totalCopyCount };
};

const updateSessionAndCheckpoint = (
  sessionId: string,
  payload: {
    image: ScriptResultPayload;
    video: ScriptResultPayload;
    outputRoot: string;
    manifest: CompressionManifestData['manifest'];
    failedCount: number;
    completedCount: number;
    totalCount: number;
    operationCounts: OperationCounts;
    activeItems: ActiveCompressionItem[];
    processedItems: ScriptResultItem[];
  }
) => {
  const db = getDb();
  const now = new Date().toISOString();
  const nextStatus = payload.failedCount > 0 ? 'failed' : 'completed';
  const session = getSessionBasics(sessionId);
  const timing = closeCompressionTimingSegment(
    getPersistedCompressionTiming(sessionId, session?.created_at ?? payload.manifest.createdAt ?? null),
    now,
    payload.failedCount > 0 ? 'fail' : 'complete'
  );

  db.prepare('UPDATE sessions SET status = ?, updated_at = ?, last_opened_at = ? WHERE id = ?').run(nextStatus, now, now, sessionId);

  db.prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?, updated_at = ?
      WHERE session_id = ? AND stage = 'compress'
    `
  ).run(
    JSON.stringify({
      outputRoot: payload.outputRoot,
      manifest: payload.manifest,
      totalCount: payload.totalCount,
      summary: {
        completedItems: payload.completedCount,
        failedItems: payload.failedCount,
        ...getOperationCounts(payload.operationCounts)
      },
      activeItems: payload.activeItems,
      processedItems: payload.processedItems,
      timing,
      image: payload.image,
      video: payload.video
    }),
    now,
    sessionId
  );

  const mediaCounts = getPersistedMediaCounts(sessionId);
  const sizeMetrics = calculateCompletedSizeMetrics(payload.processedItems);
  upsertExecutionHistory({
    sessionId,
    name: session?.name ?? null,
    sourceDir: session?.source_dir ?? payload.manifest.sourceDir,
    outputDir: session?.output_dir ?? payload.manifest.outputDir ?? '',
    outputRoot: payload.outputRoot,
    status: nextStatus,
    startedAt: session?.created_at ?? payload.manifest.createdAt ?? now,
    finishedAt: now,
    updatedAt: now,
    totalItems: payload.totalCount,
    imageItems: mediaCounts.imageItems || payload.image.items.length,
    videoItems: mediaCounts.videoItems || payload.video.items.length,
    completedItems: payload.completedCount,
    failedItems: payload.failedCount,
    originalBytes: sizeMetrics.originalBytes,
    finalBytes: sizeMetrics.finalBytes,
    imageProfileLabel: payload.manifest.imageProfileLabel,
    imageQuality: payload.manifest.imageQuality,
    videoPresetLabel: payload.manifest.videoPresetLabel,
    ...getTimingHistoryFields(timing, now, false),
    errorSummary: collectFailedItems(payload.image, payload.video)
  });
};

const updateCompressionProgressCheckpoint = (
  sessionId: string,
  payload: {
    outputRoot: string;
    manifest: CompressionManifestData['manifest'];
    totalCount: number;
    completedCount: number;
    failedCount: number;
    operationCounts: OperationCounts;
    activeItems: ActiveCompressionItem[];
    processedItems: ScriptResultItem[];
  }
) => {
  const db = getDb();
  const now = new Date().toISOString();
  const session = getSessionBasics(sessionId);
  const timing = getPersistedCompressionTiming(sessionId, session?.created_at ?? payload.manifest.createdAt ?? null);

  db.prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?, updated_at = ?
      WHERE session_id = ? AND stage = 'compress'
    `
  ).run(
    JSON.stringify({
      outputRoot: payload.outputRoot,
      manifest: payload.manifest,
      totalCount: payload.totalCount,
      summary: {
        completedItems: payload.completedCount,
        failedItems: payload.failedCount,
        ...getOperationCounts(payload.operationCounts)
      },
      activeItems: payload.activeItems,
      processedItems: payload.processedItems,
      timing
    }),
    now,
    sessionId
  );

  const mediaCounts = getPersistedMediaCounts(sessionId);
  upsertExecutionHistory({
    sessionId,
    name: session?.name ?? null,
    sourceDir: session?.source_dir ?? payload.manifest.sourceDir,
    outputDir: session?.output_dir ?? payload.manifest.outputDir ?? '',
    outputRoot: payload.outputRoot,
    status: 'running',
    startedAt: session?.created_at ?? payload.manifest.createdAt ?? now,
    finishedAt: null,
    updatedAt: now,
    totalItems: payload.totalCount,
    imageItems: mediaCounts.imageItems,
    videoItems: mediaCounts.videoItems,
    completedItems: payload.completedCount,
    failedItems: payload.failedCount,
    imageProfileLabel: payload.manifest.imageProfileLabel,
    imageQuality: payload.manifest.imageQuality,
    videoPresetLabel: payload.manifest.videoPresetLabel,
    ...getTimingHistoryFields(timing, now, true),
    errorSummary: []
  });
};

const persistCompressionItem = (
  sessionId: string,
  item: ScriptResultItem,
  outputRoot: string,
  scope: SelectionScope
) => {
  const itemId = upsertMediaItem(sessionId, item.source, outputRoot, item.output);
  const operation = item.operation ?? (isCompressOperation(item.source, scope) ? 'compress' : 'copy');
  const selectedForCompression = operation === 'compress';
  upsertDecision(sessionId, itemId, selectedForCompression);
  upsertStageStatus(sessionId, itemId, item.status, item.error ?? null);
};

const calculateProgressFromProcessedItems = (items: ScriptResultItem[], totalCompressCount: number, totalCopyCount: number) => {
  const counters = {
    completedCount: 0,
    failedCount: 0,
    totalCompressCount,
    totalCopyCount,
    completedCompressCount: 0,
    completedCopyCount: 0,
    failedCompressCount: 0,
    failedCopyCount: 0,
    retainedOriginalBecauseLargerCount: 0
  };

  for (const item of items) {
    const operation = item.operation ?? 'copy';

    if (item.status === 'completed') {
      counters.completedCount += 1;

      if (item.outcome === 'original-retained-size') {
        counters.retainedOriginalBecauseLargerCount += 1;
      } else if (operation === 'compress') {
        counters.completedCompressCount += 1;
      } else {
        counters.completedCopyCount += 1;
      }
    } else {
      counters.failedCount += 1;

      if (operation === 'compress') {
        counters.failedCompressCount += 1;
      } else {
        counters.failedCopyCount += 1;
      }
    }
  }

  return counters;
};

const toActiveCompressionItem = (item: ScriptActiveItem, scope: SelectionScope, sourceDir: string): ActiveCompressionItem => ({
  id: normalizePath(item.source),
  sourcePath: item.source,
  displayPath: getSourceDisplayPath(sourceDir, item.source),
  operation: item.operation ?? (isCompressOperation(item.source, scope) ? 'compress' : 'copy'),
  ...(typeof item.startedAt === 'number' ? { startedAt: item.startedAt } : {})
});

const withoutActiveItem = (items: ActiveCompressionItem[], sourcePath: string) => {
  const itemId = normalizePath(sourcePath);
  return items.filter((item) => item.id !== itemId);
};

const replaceProcessedItem = (items: ScriptResultItem[], item: ScriptResultItem) => {
  const itemId = normalizePath(item.source);
  const existingIndex = items.findIndex((processedItem) => normalizePath(processedItem.source) === itemId);

  if (existingIndex >= 0) {
    items.splice(existingIndex, 1, item);
    return;
  }

  items.push(item);
};

export const executeCompressionSession = async (sessionId: string) => {
  const snapshot = getCompressionSession(sessionId);

  if (!snapshot?.checkpoint) {
    throw new Error('Compression checkpoint not found for session.');
  }

  const checkpointData = parseManifestFromCheckpoint(snapshot.checkpoint.payloadJson);

  if (!checkpointData) {
    throw new Error('Compression manifest data is missing or malformed.');
  }

  const selectionScope: SelectionScope = checkpointData.manifest.selectionScope ?? {
    excludedDirectories: [],
    excludedFiles: [],
    includedDirectories: [],
    includedFiles: [],
    updatedAt: 0
  };
  const resolvedSelectionScope = resolveSelectionScope(checkpointData.manifest.sourceDir, selectionScope);

  const resumeCompletedItems = getResumeCompletedItems(sessionId, checkpointData.outputRoot);
  const imageResumeItems = resumeCompletedItems
    .filter((item) => getMediaTypeFromPath(item.source) === 'image')
    .map((item) => ({ source: item.source, output: item.output }));
  const videoResumeItems = resumeCompletedItems
    .filter((item) => getMediaTypeFromPath(item.source) === 'video')
    .map((item) => ({ source: item.source, output: item.output }));

  const imageCommand = buildImageCompressionCommand({
    sessionId,
    sourceDir: checkpointData.manifest.sourceDir,
    outputDir: snapshot.session.outputDir,
    outputRoot: checkpointData.outputRoot,
    imageOutputDir: checkpointData.manifest.imageOutputDir,
    videoOutputDir: checkpointData.manifest.videoOutputDir,
    imageQuality: checkpointData.manifest.imageQuality,
    imageProfileLabel: checkpointData.manifest.imageProfileLabel,
    videoPresetLabel: checkpointData.manifest.videoPresetLabel,
    videoOutputFormatMode: checkpointData.manifest.videoOutputFormatMode ?? 'preserve',
    imageToolCommand: checkpointData.manifest.imageToolCommand,
    videoToolCommand: checkpointData.manifest.videoToolCommand,
    imageMagickCommand: checkpointData.manifest.imageMagickCommand ?? 'magick',
    exifToolCommand: checkpointData.manifest.exifToolCommand ?? '',
    selectionScope: resolvedSelectionScope,
    createdAt: snapshot.session.createdAt
  }, imageResumeItems);

  const videoCommand = buildVideoCompressionCommand({
    sessionId,
    sourceDir: checkpointData.manifest.sourceDir,
    outputDir: snapshot.session.outputDir,
    outputRoot: checkpointData.outputRoot,
    imageOutputDir: checkpointData.manifest.imageOutputDir,
    videoOutputDir: checkpointData.manifest.videoOutputDir,
    imageQuality: checkpointData.manifest.imageQuality,
    imageProfileLabel: checkpointData.manifest.imageProfileLabel,
    videoPresetLabel: checkpointData.manifest.videoPresetLabel,
    videoOutputFormatMode: checkpointData.manifest.videoOutputFormatMode ?? 'preserve',
    imageToolCommand: checkpointData.manifest.imageToolCommand,
    videoToolCommand: checkpointData.manifest.videoToolCommand,
    imageMagickCommand: checkpointData.manifest.imageMagickCommand ?? 'magick',
    exifToolCommand: checkpointData.manifest.exifToolCommand ?? '',
    selectionScope: resolvedSelectionScope,
    createdAt: snapshot.session.createdAt
  }, videoResumeItems);

  const { totalCount, totalCompressCount, totalCopyCount } = countFilesToProcess(checkpointData.manifest.sourceDir, resolvedSelectionScope);
  const checkpointProcessedItems = (checkpointData.processedItems ?? []).map((item) =>
    enrichResultItemDisplayPath(checkpointData.manifest.sourceDir, item)
  );
  const checkpointItemsBySource = new Map(checkpointProcessedItems.map((item) => [normalizePath(item.source), item]));
  const enrichedResumeCompletedItems = resumeCompletedItems.map((item) => checkpointItemsBySource.get(normalizePath(item.source)) ?? item);
  let activeItems: ActiveCompressionItem[] = [];
  const completedSources = new Set(resumeCompletedItems.map((item) => normalizePath(item.source)));
  const processedItems: ScriptResultItem[] = [
    ...enrichedResumeCompletedItems,
    ...checkpointProcessedItems.filter((item) => item.status === 'failed' && !completedSources.has(normalizePath(item.source)))
  ];
  let progressState = calculateProgressFromProcessedItems(processedItems, totalCompressCount, totalCopyCount);

  // Seed the checkpoint with the total before any phase finishes.
  updateCompressionProgressCheckpoint(sessionId, {
    outputRoot: checkpointData.outputRoot,
    manifest: checkpointData.manifest,
    totalCount,
    completedCount: progressState.completedCount,
    failedCount: progressState.failedCount,
    operationCounts: progressState,
    activeItems,
    processedItems
  });

  const imageResult = await executeCommand(sessionId, imageCommand.command, imageCommand.args, (item) => {
    activeItems = [toActiveCompressionItem(item, resolvedSelectionScope, checkpointData.manifest.sourceDir)];

    updateCompressionProgressCheckpoint(sessionId, {
      outputRoot: checkpointData.outputRoot,
      manifest: checkpointData.manifest,
      totalCount,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      operationCounts: progressState,
      activeItems,
      processedItems
    });
  }, (item) => {
    const displayItem = enrichResultItemDisplayPath(checkpointData.manifest.sourceDir, item);
    persistCompressionItem(sessionId, displayItem, checkpointData.outputRoot, resolvedSelectionScope);
    activeItems = withoutActiveItem(activeItems, displayItem.source);
    replaceProcessedItem(processedItems, displayItem);
    progressState = calculateProgressFromProcessedItems(processedItems, totalCompressCount, totalCopyCount);

    updateCompressionProgressCheckpoint(sessionId, {
      outputRoot: checkpointData.outputRoot,
      manifest: checkpointData.manifest,
      totalCount,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      operationCounts: progressState,
      activeItems,
      processedItems
    });
  });

  if (imageResult.paused) {
    clearCompressionPauseRequest(sessionId);
    updateCompressionProgressCheckpoint(sessionId, {
      outputRoot: checkpointData.outputRoot,
      manifest: checkpointData.manifest,
      totalCount,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      operationCounts: progressState,
      activeItems: [],
      processedItems
    });

    return {
      sessionId,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      totalCount
    };
  }

  const videoResult = await executeCommand(sessionId, videoCommand.command, videoCommand.args, (item) => {
    activeItems = [toActiveCompressionItem(item, resolvedSelectionScope, checkpointData.manifest.sourceDir)];

    updateCompressionProgressCheckpoint(sessionId, {
      outputRoot: checkpointData.outputRoot,
      manifest: checkpointData.manifest,
      totalCount,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      operationCounts: progressState,
      activeItems,
      processedItems
    });
  }, (item) => {
    const displayItem = enrichResultItemDisplayPath(checkpointData.manifest.sourceDir, item);
    persistCompressionItem(sessionId, displayItem, checkpointData.outputRoot, resolvedSelectionScope);
    activeItems = withoutActiveItem(activeItems, displayItem.source);
    replaceProcessedItem(processedItems, displayItem);
    progressState = calculateProgressFromProcessedItems(processedItems, totalCompressCount, totalCopyCount);

    updateCompressionProgressCheckpoint(sessionId, {
      outputRoot: checkpointData.outputRoot,
      manifest: checkpointData.manifest,
      totalCount,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      operationCounts: progressState,
      activeItems,
      processedItems
    });
  });

  if (videoResult.paused) {
    clearCompressionPauseRequest(sessionId);
    updateCompressionProgressCheckpoint(sessionId, {
      outputRoot: checkpointData.outputRoot,
      manifest: checkpointData.manifest,
      totalCount,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      operationCounts: progressState,
      activeItems: [],
      processedItems
    });

    return {
      sessionId,
      completedCount: progressState.completedCount,
      failedCount: progressState.failedCount,
      totalCount
    };
  }

  clearCompressionPauseRequest(sessionId);

  // Log results for debugging
  console.log(`[compression] Session ${sessionId}: images=${imageResult.items.length}, videos=${videoResult.items.length}, total=${imageResult.items.length + videoResult.items.length}`);

  updateCompressionProgressCheckpoint(sessionId, {
    outputRoot: checkpointData.outputRoot,
    manifest: checkpointData.manifest,
    totalCount,
    completedCount: progressState.completedCount,
    failedCount: progressState.failedCount,
    operationCounts: progressState,
    activeItems: [],
    processedItems
  });

  updateSessionAndCheckpoint(sessionId, {
    image: imageResult,
    video: videoResult,
    outputRoot: checkpointData.outputRoot,
    manifest: checkpointData.manifest,
    completedCount: progressState.completedCount,
    failedCount: progressState.failedCount,
    totalCount,
    operationCounts: progressState,
    activeItems: [],
    processedItems
  });

  return {
    sessionId,
    completedCount: progressState.completedCount,
    failedCount: progressState.failedCount,
    totalCount
  };
};
