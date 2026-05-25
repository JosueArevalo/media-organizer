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

type ScriptResultItem = {
  source: string;
  output: string;
  command: string[];
  status: 'completed' | 'failed';
  operation?: 'compress' | 'copy';
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  skipped?: boolean;
  error?: string;
  warning?: string;
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
};

type ScriptProgressEvent = {
  type: 'start' | 'item' | 'complete';
  item?: ScriptActiveItem | ScriptResultItem;
  items?: ScriptResultItem[];
};

type ActiveCompressionItem = {
  id: string;
  sourcePath: string;
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
    imageToolCommand: string;
    videoToolCommand: string;
    imageMagickCommand?: string;
    exifToolCommand?: string;
    selectionScope?: SelectionScope;
    createdAt?: string;
  };
  processedItems?: ScriptResultItem[];
};

type OperationCounts = {
  totalCompressCount: number;
  totalCopyCount: number;
  completedCompressCount: number;
  completedCopyCount: number;
  failedCompressCount: number;
  failedCopyCount: number;
};

const executeCommand = async (
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

    child.on('error', reject);

    child.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      stdoutReader.close();

      console.log(`[executeCommand] command=${command} args=${JSON.stringify(args)} code=${code}`);
      if (stderr) console.log(`[executeCommand] stderr=${stderr}`);

      if (code !== 0) {
        reject(new Error(`Compression script failed with code ${code}: ${stderr || 'No output provided.'}`));
        return;
      }

      console.log(`[executeCommand] parsed ${items.length} items`);
      resolve({ items });
    });
  });
};

const normalizePath = (value: string) => path.resolve(value).replace(/\\/g, '/').toLowerCase();

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
  failedCopyCount: counts.failedCopyCount
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
      image: payload.image,
      video: payload.video
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
    status: nextStatus,
    startedAt: session?.created_at ?? payload.manifest.createdAt ?? now,
    finishedAt: now,
    updatedAt: now,
    totalItems: payload.totalCount,
    imageItems: mediaCounts.imageItems || payload.image.items.length,
    videoItems: mediaCounts.videoItems || payload.video.items.length,
    completedItems: payload.completedCount,
    failedItems: payload.failedCount,
    imageProfileLabel: payload.manifest.imageProfileLabel,
    videoPresetLabel: payload.manifest.videoPresetLabel,
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
      processedItems: payload.processedItems
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
    videoPresetLabel: payload.manifest.videoPresetLabel,
    errorSummary: []
  });
};

const persistCompressionItem = (
  sessionId: string,
  item: ScriptResultItem,
  outputRoot: string,
  scope: SelectionScope,
  counters: { completedCount: number; failedCount: number } & OperationCounts
) => {
  const itemId = upsertMediaItem(sessionId, item.source, outputRoot, item.output);
  const operation = item.operation ?? (isCompressOperation(item.source, scope) ? 'compress' : 'copy');
  const selectedForCompression = operation === 'compress';
  upsertDecision(sessionId, itemId, selectedForCompression);
  upsertStageStatus(sessionId, itemId, item.status, item.error ?? null);

  if (item.status === 'completed') {
    counters.completedCount += 1;

    if (operation === 'compress') {
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
};

const toActiveCompressionItem = (item: ScriptActiveItem, scope: SelectionScope): ActiveCompressionItem => ({
  id: normalizePath(item.source),
  sourcePath: item.source,
  operation: item.operation ?? (isCompressOperation(item.source, scope) ? 'compress' : 'copy'),
  ...(typeof item.startedAt === 'number' ? { startedAt: item.startedAt } : {})
});

const withoutActiveItem = (items: ActiveCompressionItem[], sourcePath: string) => {
  const itemId = normalizePath(sourcePath);
  return items.filter((item) => item.id !== itemId);
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

  console.log(`[executeCompressionSession] Starting: session=${sessionId}`);
  console.log(`[executeCompressionSession] sourceDir=${checkpointData.manifest.sourceDir}`);
  console.log(`[executeCompressionSession] selectionScope=`, selectionScope);

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
    imageToolCommand: checkpointData.manifest.imageToolCommand,
    videoToolCommand: checkpointData.manifest.videoToolCommand,
    imageMagickCommand: checkpointData.manifest.imageMagickCommand ?? 'magick',
    exifToolCommand: checkpointData.manifest.exifToolCommand ?? '',
    selectionScope: resolvedSelectionScope,
    createdAt: snapshot.session.createdAt
  });

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
    imageToolCommand: checkpointData.manifest.imageToolCommand,
    videoToolCommand: checkpointData.manifest.videoToolCommand,
    imageMagickCommand: checkpointData.manifest.imageMagickCommand ?? 'magick',
    exifToolCommand: checkpointData.manifest.exifToolCommand ?? '',
    selectionScope: resolvedSelectionScope,
    createdAt: snapshot.session.createdAt
  });

  const { totalCount, totalCompressCount, totalCopyCount } = countFilesToProcess(checkpointData.manifest.sourceDir, resolvedSelectionScope);
  const progressState = {
    completedCount: 0,
    failedCount: 0,
    totalCompressCount,
    totalCopyCount,
    completedCompressCount: 0,
    completedCopyCount: 0,
    failedCompressCount: 0,
    failedCopyCount: 0
  };
  let activeItems: ActiveCompressionItem[] = checkpointData.activeItems ?? [];
  const processedItems: ScriptResultItem[] = checkpointData.processedItems ?? [];

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

  const imageResult = await executeCommand(imageCommand.command, imageCommand.args, (item) => {
    activeItems = [toActiveCompressionItem(item, resolvedSelectionScope)];

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
    persistCompressionItem(sessionId, item, checkpointData.outputRoot, resolvedSelectionScope, progressState);
    activeItems = withoutActiveItem(activeItems, item.source);
    processedItems.push(item);

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

  const videoResult = await executeCommand(videoCommand.command, videoCommand.args, (item) => {
    activeItems = [toActiveCompressionItem(item, resolvedSelectionScope)];

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
    persistCompressionItem(sessionId, item, checkpointData.outputRoot, resolvedSelectionScope, progressState);
    activeItems = withoutActiveItem(activeItems, item.source);
    processedItems.push(item);

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
