import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import type { MediaType } from '../../state/dto/state.types.js';
import {
  updateExecutionVerification,
  updateGroupingExecutionSummary,
  type ExecutionVerification,
  type VerificationCounts
} from '../../dashboard/dashboard.service.js';
import { startGroupingSession } from './groupingJob.service.js';
import type {
  GroupingDateOptions,
  GroupingRuleId,
  GroupingSourceFolderOptions,
  GroupingStrategy
} from './grouping.types.js';

type FolderKind = 'proposed' | 'manual' | 'template';

export type GroupingWorkspaceRequest = {
  name?: string;
  sourceDir: string;
  outputDir: string;
  compressionSessionId: string;
};

export type GroupingReorganizeRequest = {
  rules?: GroupingRuleId[];
  strategy?: GroupingStrategy | null;
  dateOptions?: GroupingDateOptions;
  sourceFolderOptions?: GroupingSourceFolderOptions;
  preservedDirectories: string[];
  reorganizedDirectories: string[];
};

export type GroupingWorkspaceFolder = {
  id: string;
  label: string;
  kind: FolderKind;
  itemCount: number;
};

export type GroupingWorkspaceItem = {
  id: string;
  sourcePath: string;
  relativePath: string;
  outputPath: string;
  fileName: string;
  mediaType: MediaType;
  sizeBytes: number;
  captureDate: string | null;
  targetGroupLabel: string | null;
  preservedStructure: boolean;
};

export type GroupingWorkspaceTemplate = {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
};

export type GroupingWorkspace = {
  sessionId: string;
  sourceDir: string;
  outputDir: string;
  compressionSessionId: string | null;
  rules: GroupingRuleId[];
  strategy: GroupingStrategy | null;
  dateOptions: GroupingDateOptions;
  sourceFolderOptions: GroupingSourceFolderOptions;
  preservedDirectories: string[];
  reorganizedDirectories: string[];
  folders: GroupingWorkspaceFolder[];
  items: GroupingWorkspaceItem[];
  templates: GroupingWorkspaceTemplate[];
};

type MediaRow = {
  id: string;
  source_path: string;
  relative_path: string;
  media_type: MediaType;
  size_bytes: number;
  capture_time: string | null;
  target_group_label: string | null;
};

const MEDIA_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.mp4',
  '.mov',
  '.m4v',
  '.avi',
  '.mkv'
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv']);
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);
const WEB_SAFE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const PREVIEW_MAX_SIZE = '2400x2400';
const PREVIEW_QUALITY = '85';

export class GroupingPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupingPreviewError';
  }
}

const nowIso = () => new Date().toISOString();

const normalizePath = (value: string) => path.resolve(value);

const normalizeScopePath = (value: string) => path.resolve(value).replace(/\\/g, '/').toLowerCase();

const isPathInside = (parentPath: string, childPath: string) => {
  const relative = path.relative(normalizePath(parentPath), normalizePath(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const sanitizeFolderLabel = (label: string) => {
  const sanitized = label
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return sanitized || 'Sin nombre';
};

const DEFAULT_DATE_OPTIONS: GroupingDateOptions = { singleDateHandling: 'year-unique' };
const DEFAULT_SOURCE_FOLDER_OPTIONS: GroupingSourceFolderOptions = { mode: 'nearest-folder' };

const formatDateLabel = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return {
    dateKey: `${year}-${month}-${day}`,
    folderDate: `${year}.${month}.${day}`,
    tokenDate: `${year}.${month}.${day}`,
    year: String(year)
  };
};

const parseDateFromName = (fileName: string): Date | null => {
  const compact = fileName.match(/(?:^|[^0-9])((?:19|20)\d{2})([01]\d)([0-3]\d)(?:[^0-9]|$)/);

  if (compact) {
    const year = Number(compact[1]);
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const separated = fileName.match(/((?:19|20)\d{2})[-_. ]([01]\d)[-_. ]([0-3]\d)/);

  if (separated) {
    const year = Number(separated[1]);
    const month = Number(separated[2]);
    const day = Number(separated[3]);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

const getCaptureDate = (outputPath: string, relativePath: string): Date | null => {
  const fromName = parseDateFromName(path.basename(relativePath));

  if (fromName) {
    return fromName;
  }

  try {
    return fs.statSync(outputPath).mtime;
  } catch {
    return null;
  }
};

const getProposalDate = (row: MediaRow): Date | null => {
  const fromName = parseDateFromName(path.basename(row.relative_path));

  if (fromName) {
    return fromName;
  }

  if (row.capture_time) {
    const fromMetadata = new Date(row.capture_time);
    return Number.isNaN(fromMetadata.getTime()) ? null : fromMetadata;
  }

  return null;
};

const getOutputPath = (outputDir: string, relativePath: string) => path.join(outputDir, relativePath);

const createEmptyVerificationCounts = (): VerificationCounts => ({
  total: 0,
  images: 0,
  videos: 0,
  unknown: 0
});

const incrementCounts = (counts: VerificationCounts, mediaType: MediaType) => {
  counts.total += 1;

  if (mediaType === 'image') {
    counts.images += 1;
    return;
  }

  if (mediaType === 'video') {
    counts.videos += 1;
    return;
  }

  counts.unknown += 1;
};

const classifyFilePath = (filePath: string): MediaType => {
  const extension = path.extname(filePath).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }

  return 'unknown';
};

const scanDestinationCounts = (directoryPath: string): VerificationCounts => {
  const counts = createEmptyVerificationCounts();

  if (!fs.existsSync(directoryPath)) {
    return counts;
  }

  const walk = (currentPath: string) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.name === '.media-organizer') {
        continue;
      }

      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      incrementCounts(counts, classifyFilePath(entryPath));
    }
  };

  walk(directoryPath);
  return counts;
};

const countWorkspaceItems = (items: GroupingWorkspaceItem[]): VerificationCounts => {
  const counts = createEmptyVerificationCounts();

  for (const item of items) {
    incrementCounts(counts, item.mediaType);
  }

  return counts;
};

const countsMatch = (left: VerificationCounts, right: VerificationCounts) =>
  left.total === right.total &&
  left.images === right.images &&
  left.videos === right.videos &&
  left.unknown === right.unknown;

const verifyWorkspaceDestination = (workspace: GroupingWorkspace, verifiedAt: string): ExecutionVerification => {
  const expected = countWorkspaceItems(workspace.items);
  const destination = scanDestinationCounts(workspace.outputDir);

  return {
    status: countsMatch(expected, destination) ? 'ok' : 'mismatch',
    expected,
    destination,
    verifiedAt,
    outputRoot: workspace.outputDir
  };
};

export const verifyGroupingWorkspaceDestination = (sessionId: string, verifiedAt = nowIso()): ExecutionVerification | null => {
  const workspace = getGroupingWorkspace(sessionId);

  if (!workspace) {
    return null;
  }

  return verifyWorkspaceDestination(workspace, verifiedAt);
};

const getCompressionSourceSessionId = (groupingSessionId: string) => {
  const db = getDb();
  const row = db
    .prepare('SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(groupingSessionId, 'group') as { payload_json: string | null } | undefined;

  if (!row?.payload_json) {
    return null;
  }

  try {
    const payload = JSON.parse(row.payload_json) as { manifest?: { compressionSessionId?: string | null } };
    return payload.manifest?.compressionSessionId ?? null;
  } catch {
    return null;
  }
};

const getGroupingManifest = (groupingSessionId: string) => {
  const db = getDb();
  const row = db
    .prepare('SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(groupingSessionId, 'group') as { payload_json: string | null } | undefined;

  if (!row?.payload_json) {
    return null;
  }

  try {
    const payload = JSON.parse(row.payload_json) as {
      manifest?: {
        compressionSessionId?: string | null;
        preservedDirectories?: string[];
        reorganizedDirectories?: string[];
        rules?: GroupingRuleId[];
        strategy?: GroupingStrategy | null;
        dateOptions?: GroupingDateOptions;
        sourceFolderOptions?: GroupingSourceFolderOptions;
      };
    };
    return payload.manifest ?? null;
  } catch {
    return null;
  }
};

const getCompressionManifest = (compressionSessionId: string | null) => {
  if (!compressionSessionId) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare('SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(compressionSessionId, 'compress') as { payload_json: string | null } | undefined;

  if (!row?.payload_json) {
    return null;
  }

  try {
    const payload = JSON.parse(row.payload_json) as { manifest?: { imageMagickCommand?: string | null } };
    return payload.manifest ?? null;
  } catch {
    return null;
  }
};

const getSessionRow = (sessionId: string) => {
  const db = getDb();
  return db
    .prepare('SELECT id, source_dir, output_dir, status FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; source_dir: string; output_dir: string; status: string } | undefined;
};

const listMediaRows = (sessionId: string): MediaRow[] => {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT
          mi.id,
          mi.source_path,
          mi.relative_path,
          mi.media_type,
          mi.size_bytes,
          mi.capture_time,
          decision.target_group_label
        FROM media_items mi
        LEFT JOIN item_decisions decision
          ON decision.session_id = mi.session_id
          AND decision.item_id = mi.id
        WHERE mi.session_id = ?
          AND COALESCE(decision.selected_for_output, 1) = 1
        ORDER BY mi.relative_path ASC
      `
    )
    .all(sessionId) as MediaRow[];
};

const listMediaRowsByIds = (sessionId: string, itemIds: string[]): MediaRow[] => {
  if (itemIds.length === 0) {
    return [];
  }

  const db = getDb();
  const placeholders = itemIds.map(() => '?').join(', ');
  return db
    .prepare(
      `
        SELECT
          mi.id,
          mi.source_path,
          mi.relative_path,
          mi.media_type,
          mi.size_bytes,
          mi.capture_time,
          decision.target_group_label
        FROM media_items mi
        LEFT JOIN item_decisions decision
          ON decision.session_id = mi.session_id
          AND decision.item_id = mi.id
        WHERE mi.session_id = ?
          AND mi.id IN (${placeholders})
          AND COALESCE(decision.selected_for_output, 1) = 1
      `
    )
    .all(sessionId, ...itemIds) as MediaRow[];
};

const listDeletedMediaRows = (sessionId: string): MediaRow[] => {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT
          mi.id,
          mi.source_path,
          mi.relative_path,
          mi.media_type,
          mi.size_bytes,
          mi.capture_time,
          decision.target_group_label
        FROM media_items mi
        INNER JOIN item_decisions decision
          ON decision.session_id = mi.session_id
          AND decision.item_id = mi.id
        WHERE mi.session_id = ?
          AND decision.selected_for_output = 0
        ORDER BY mi.relative_path ASC
      `
    )
    .all(sessionId) as MediaRow[];
};

const getFolderRows = (sessionId: string) => {
  const db = getDb();
  return db
    .prepare('SELECT id, label, kind FROM grouping_folders WHERE session_id = ? ORDER BY label ASC')
    .all(sessionId) as Array<{ id: string; label: string; kind: FolderKind }>;
};

const upsertFolder = (sessionId: string, label: string, kind: FolderKind) => {
  const db = getDb();
  const timestamp = nowIso();
  const safeLabel = sanitizeFolderLabel(label);

  db.prepare(
    `
      INSERT INTO grouping_folders (id, session_id, label, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, label) DO UPDATE SET
        kind = CASE WHEN grouping_folders.kind = 'manual' THEN grouping_folders.kind ELSE excluded.kind END,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), sessionId, safeLabel, kind, timestamp, timestamp);

  return db
    .prepare('SELECT id, label, kind FROM grouping_folders WHERE session_id = ? AND label = ?')
    .get(sessionId, safeLabel) as { id: string; label: string; kind: FolderKind };
};

const upsertDecisionLabel = (sessionId: string, itemId: string, label: string, userOverridden: boolean) => {
  const db = getDb();
  const timestamp = nowIso();

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
      ) VALUES (?, ?, ?, 0, 1, ?, ?, ?)
      ON CONFLICT(session_id, item_id) DO UPDATE SET
        target_group_label = excluded.target_group_label,
        user_overridden = excluded.user_overridden,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), sessionId, itemId, sanitizeFolderLabel(label), userOverridden ? 1 : 0, timestamp);
};

const resolveScopePath = (sourceDir: string, scopePath: string) => {
  const trimmed = scopePath.trim();

  if (!trimmed) {
    return normalizeScopePath(sourceDir);
  }

  if (path.isAbsolute(trimmed)) {
    return normalizeScopePath(trimmed);
  }

  const normalizedInput = trimmed.replace(/\\/g, '/').replace(/^\/+/, '');
  const sourceRootName = path.basename(sourceDir).replace(/\\/g, '/').toLowerCase();
  const segments = normalizedInput.split('/').filter(Boolean);

  if (segments[0]?.toLowerCase() === sourceRootName) {
    segments.shift();
  }

  return normalizeScopePath(path.join(sourceDir, ...segments));
};

const isPathInsideOrEqualNormalized = (parentPath: string, childPath: string) =>
  childPath === parentPath || childPath.startsWith(`${parentPath}/`);

const resolveDirectoryScopes = (sourceDir: string, directories: string[]) =>
  directories.map((entry) => resolveScopePath(sourceDir, entry));

const findClosestScopeMatch = (sourcePath: string, directories: string[]) =>
  directories
    .filter((directory) => isPathInsideOrEqualNormalized(directory, sourcePath))
    .sort((left, right) => right.length - left.length)[0] ?? null;

const isCandidatePathPreserved = (
  candidatePath: string,
  preservedScopes: string[],
  reorganizedScopes: string[]
) => {
  const preservedMatch = findClosestScopeMatch(candidatePath, preservedScopes);

  if (!preservedMatch) {
    return false;
  }

  const reorganizedMatch = findClosestScopeMatch(candidatePath, reorganizedScopes);
  return !reorganizedMatch || preservedMatch.length > reorganizedMatch.length;
};

const isRowPreserved = (
  sourceDir: string,
  row: MediaRow,
  preservedDirectories: string[],
  reorganizedDirectories: string[]
) => {
  if (preservedDirectories.length === 0) {
    return false;
  }

  const preservedScopes = resolveDirectoryScopes(sourceDir, preservedDirectories);
  const reorganizedScopes = resolveDirectoryScopes(sourceDir, reorganizedDirectories);
  const candidates = Array.from(
    new Set([
      normalizeScopePath(row.source_path),
      normalizeScopePath(path.join(sourceDir, row.relative_path))
    ])
  );

  return candidates.some((candidatePath) => isCandidatePathPreserved(candidatePath, preservedScopes, reorganizedScopes));
};

const assertItemsAreNotPreserved = (groupingSessionId: string, sourceSessionId: string, itemIds: string[]) => {
  const uniqueItemIds = Array.from(new Set(itemIds));
  if (uniqueItemIds.length === 0) {
    return;
  }

  const session = getSessionRow(groupingSessionId);
  const groupingManifest = getGroupingManifest(groupingSessionId);
  const preservedDirectories = groupingManifest?.preservedDirectories ?? [];

  if (!session || preservedDirectories.length === 0) {
    return;
  }

  const reorganizedDirectories = groupingManifest?.reorganizedDirectories ?? [];
  const preservedRows = listMediaRowsByIds(sourceSessionId, uniqueItemIds).filter((row) =>
    isRowPreserved(session.source_dir, row, preservedDirectories, reorganizedDirectories)
  );

  if (preservedRows.length > 0) {
    throw new Error('Cannot modify media inside a preserved folder.');
  }
};

const clearGeneratedGrouping = (groupingSessionId: string, sourceSessionId: string) => {
  const db = getDb();

  db.prepare("DELETE FROM grouping_folders WHERE session_id = ? AND kind = 'proposed'").run(groupingSessionId);
  db.prepare(
    `
      UPDATE item_decisions
      SET target_group_label = NULL,
          user_overridden = 0,
          updated_at = ?
      WHERE session_id = ?
        AND user_overridden = 0
    `
  ).run(nowIso(), sourceSessionId);
};

const getRulesFromStrategy = (
  strategy: GroupingStrategy | null,
  dateOptions: GroupingDateOptions
): GroupingRuleId[] => {
  if (strategy !== 'date') {
    return [];
  }

  return dateOptions.singleDateHandling === 'year-unique'
    ? ['date-event-multiple', 'single-date-year-unique']
    : ['date-event-multiple'];
};

const getStrategyFromLegacyRules = (rules: GroupingRuleId[]) => {
  if (!rules.includes('date-event-multiple') && !rules.includes('single-date-year-unique')) {
    return {
      strategy: null,
      dateOptions: DEFAULT_DATE_OPTIONS,
      rules: [] as GroupingRuleId[]
    };
  }

  const dateOptions: GroupingDateOptions = {
    singleDateHandling: rules.includes('single-date-year-unique') ? 'year-unique' : 'keep-original'
  };

  return {
    strategy: 'date' as const,
    dateOptions,
    rules: getRulesFromStrategy('date', dateOptions)
  };
};

const normalizeReorganizeConfig = (request: GroupingReorganizeRequest) => {
  if (request.strategy) {
    const dateOptions = request.dateOptions ?? DEFAULT_DATE_OPTIONS;
    const sourceFolderOptions = request.sourceFolderOptions ?? DEFAULT_SOURCE_FOLDER_OPTIONS;
    return {
      strategy: request.strategy,
      dateOptions,
      sourceFolderOptions,
      rules: getRulesFromStrategy(request.strategy, dateOptions)
    };
  }

  return {
    ...getStrategyFromLegacyRules(Array.from(new Set(request.rules ?? []))),
    sourceFolderOptions: request.sourceFolderOptions ?? DEFAULT_SOURCE_FOLDER_OPTIONS
  };
};

const getSourceFolderLabel = (relativePath: string, options: GroupingSourceFolderOptions) => {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  segments.pop();

  if (segments.length === 0) {
    return null;
  }

  if (options.mode === 'relative-path') {
    return sanitizeFolderLabel(segments.join(' - '));
  }

  return sanitizeFolderLabel(segments[segments.length - 1]);
};

const buildProposalLabels = (
  sourceDir: string,
  outputDir: string,
  rows: MediaRow[],
  preservedDirectories: string[],
  reorganizedDirectories: string[],
  strategy: GroupingStrategy | null,
  dateOptions: GroupingDateOptions,
  sourceFolderOptions: GroupingSourceFolderOptions
) => {
  const datedRows = rows.map((row) => {
    const outputPath = getOutputPath(outputDir, row.relative_path);
    const captureDate = getProposalDate(row);
    const preservedStructure = isRowPreserved(sourceDir, row, preservedDirectories, reorganizedDirectories);
    return { row, outputPath, captureDate, preservedStructure };
  });
  if (strategy === 'source-folder') {
    return datedRows.map((item) => ({
      ...item,
      label: item.preservedStructure ? null : getSourceFolderLabel(item.row.relative_path, sourceFolderOptions)
    }));
  }

  if (strategy !== 'date') {
    return datedRows.map((item) => ({ ...item, label: null }));
  }

  const dateCounts = new Map<string, number>();
  for (const item of datedRows) {
    if (item.preservedStructure || !item.captureDate) {
      continue;
    }

    const { dateKey } = formatDateLabel(item.captureDate);
    dateCounts.set(dateKey, (dateCounts.get(dateKey) ?? 0) + 1);
  }

  return datedRows.map((item) => {
    if (item.preservedStructure) {
      return { ...item, label: null };
    }

    if (!item.captureDate) {
      return { ...item, label: null };
    }

    const formatted = formatDateLabel(item.captureDate);
    const count = dateCounts.get(formatted.dateKey) ?? 0;
    let label: string | null = null;

    if (count > 1 || dateOptions.singleDateHandling === 'daily-event') {
      label = `${formatted.folderDate} - Event`;
    }

    if (count === 1 && dateOptions.singleDateHandling === 'year-unique') {
      label = `${formatted.year} - Unique`;
    }

    return { ...item, label };
  });
};

const getTemplateRows = (): GroupingWorkspaceTemplate[] => {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, name, pattern, enabled FROM grouping_folder_templates ORDER BY name ASC')
    .all() as Array<{ id: string; name: string; pattern: string; enabled: number }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    enabled: row.enabled === 1
  }));
};

const buildWorkspace = (groupingSessionId: string): GroupingWorkspace | null => {
  runMigrations();

  const session = getSessionRow(groupingSessionId);

  if (!session) {
    return null;
  }

  const compressionSessionId = getCompressionSourceSessionId(groupingSessionId);
  const groupingManifest = getGroupingManifest(groupingSessionId);
  const preservedDirectories = groupingManifest?.preservedDirectories ?? [];
  const reorganizedDirectories = groupingManifest?.reorganizedDirectories ?? [];
  const rules = groupingManifest?.rules ?? [];
  const strategy = groupingManifest?.strategy ?? null;
  const dateOptions = groupingManifest?.dateOptions ?? DEFAULT_DATE_OPTIONS;
  const sourceFolderOptions = groupingManifest?.sourceFolderOptions ?? DEFAULT_SOURCE_FOLDER_OPTIONS;
  const sourceSessionId = compressionSessionId ?? groupingSessionId;
  const mediaRows = listMediaRows(sourceSessionId);
  const folders = getFolderRows(groupingSessionId);
  const counts = new Map<string, number>();

  for (const row of mediaRows) {
    if (row.target_group_label) {
      counts.set(row.target_group_label, (counts.get(row.target_group_label) ?? 0) + 1);
    }
  }

  return {
    sessionId: groupingSessionId,
    sourceDir: session.source_dir,
    outputDir: session.output_dir,
    compressionSessionId,
    rules,
    strategy,
    dateOptions,
    sourceFolderOptions,
    preservedDirectories,
    reorganizedDirectories,
    folders: folders.map((folder) => ({
      id: folder.id,
      label: folder.label,
      kind: folder.kind,
      itemCount: counts.get(folder.label) ?? 0
    })),
    items: mediaRows.map((row) => {
      const outputPath = getOutputPath(session.output_dir, row.relative_path);
      const captureDate = getCaptureDate(outputPath, row.relative_path);
      const preservedStructure = isRowPreserved(session.source_dir, row, preservedDirectories, reorganizedDirectories);
      return {
        id: row.id,
        sourcePath: row.source_path,
        relativePath: row.relative_path,
        outputPath,
        fileName: path.basename(row.relative_path),
        mediaType: row.media_type,
        sizeBytes: row.size_bytes,
        captureDate: captureDate ? formatDateLabel(captureDate).dateKey : row.capture_time,
        targetGroupLabel: row.target_group_label,
        preservedStructure
      };
    }),
    templates: getTemplateRows()
  };
};

export const createGroupingWorkspace = (request: GroupingWorkspaceRequest): GroupingWorkspace => {
  runMigrations();

  const grouping = startGroupingSession({
    name: request.name,
    sourceDir: request.sourceDir,
    outputDir: request.outputDir,
    compressionSessionId: request.compressionSessionId,
    preservedDirectories: [],
    reorganizedDirectories: [],
    rules: [],
    strategy: null,
    dateOptions: DEFAULT_DATE_OPTIONS,
    sourceFolderOptions: DEFAULT_SOURCE_FOLDER_OPTIONS,
    autoRename: true
  });

  const workspace = buildWorkspace(grouping.session.id);

  if (!workspace) {
    throw new Error('Could not create grouping workspace.');
  }

  return workspace;
};

export const reorganizeGroupingWorkspace = (sessionId: string, request: GroupingReorganizeRequest): GroupingWorkspace | null => {
  runMigrations();

  const workspace = getGroupingWorkspace(sessionId);

  if (!workspace) {
    return null;
  }

  const sourceSessionId = workspace.compressionSessionId ?? sessionId;
  const timestamp = nowIso();
  const config = normalizeReorganizeConfig(request);
  const rows = listMediaRows(sourceSessionId);
  clearGeneratedGrouping(sessionId, sourceSessionId);

  const proposals = buildProposalLabels(
    workspace.sourceDir,
    workspace.outputDir,
    rows,
    request.preservedDirectories ?? [],
    request.reorganizedDirectories ?? [],
    config.strategy,
    config.dateOptions,
    config.sourceFolderOptions
  );

  for (const proposal of proposals) {
    if (proposal.label) {
      upsertFolder(sessionId, proposal.label, 'proposed');
      upsertDecisionLabel(sourceSessionId, proposal.row.id, proposal.label, false);
    }
  }

  const db = getDb();
  const currentManifest = getGroupingManifest(sessionId);
  db.prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?, updated_at = ?
      WHERE session_id = ? AND stage = 'group'
    `
  ).run(
    JSON.stringify({
      outputRoot: workspace.outputDir,
      manifest: {
        ...currentManifest,
        compressionSessionId: workspace.compressionSessionId,
        preservedDirectories: request.preservedDirectories ?? [],
        reorganizedDirectories: request.reorganizedDirectories ?? [],
        rules: config.rules,
        strategy: config.strategy,
        dateOptions: config.dateOptions,
        sourceFolderOptions: config.sourceFolderOptions
      },
      totalCount: rows.length,
      summary: { completedItems: 0, failedItems: 0 }
    }),
    timestamp,
    sessionId
  );

  return getGroupingWorkspace(sessionId);
};

export const getGroupingWorkspace = (groupingSessionId: string) => buildWorkspace(groupingSessionId);

export const createGroupingFolder = (sessionId: string, label: string, kind: FolderKind = 'manual') => {
  runMigrations();
  return upsertFolder(sessionId, label, kind);
};

export const renameGroupingFolder = (sessionId: string, folderId: string, label: string) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();
  const safeLabel = sanitizeFolderLabel(label);
  const current = db
    .prepare('SELECT label FROM grouping_folders WHERE session_id = ? AND id = ?')
    .get(sessionId, folderId) as { label: string } | undefined;

  if (!current) {
    return null;
  }

  db.exec('BEGIN TRANSACTION');

  try {
    db.prepare('UPDATE grouping_folders SET label = ?, updated_at = ? WHERE session_id = ? AND id = ?').run(
      safeLabel,
      timestamp,
      sessionId,
      folderId
    );
    const sourceSessionId = getCompressionSourceSessionId(sessionId) ?? sessionId;
    db.prepare(
      `
        UPDATE item_decisions
        SET target_group_label = ?, updated_at = ?
        WHERE session_id = ?
        AND target_group_label = ?
      `
    ).run(safeLabel, timestamp, sourceSessionId, current.label);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return db
    .prepare('SELECT id, label, kind FROM grouping_folders WHERE session_id = ? AND id = ?')
    .get(sessionId, folderId) as { id: string; label: string; kind: FolderKind };
};

export const deleteGroupingFolder = (sessionId: string, folderId: string) => {
  runMigrations();
  const db = getDb();
  const folder = db
    .prepare('SELECT label FROM grouping_folders WHERE session_id = ? AND id = ?')
    .get(sessionId, folderId) as { label: string } | undefined;

  if (!folder) {
    return false;
  }

  const sourceSessionId = getCompressionSourceSessionId(sessionId) ?? sessionId;
  const usage = db
    .prepare(
      `
        SELECT COUNT(*) AS total
        FROM item_decisions
        WHERE session_id = ?
          AND target_group_label = ?
          AND selected_for_output = 1
      `
    )
    .get(sourceSessionId, folder.label) as { total: number };

  if (usage.total > 0) {
    throw new Error('Cannot delete a folder that contains media items.');
  }

  db.prepare('DELETE FROM grouping_folders WHERE session_id = ? AND id = ?').run(sessionId, folderId);
  return true;
};

export const assignGroupingItems = (sessionId: string, itemIds: string[], targetGroupLabel: string) => {
  runMigrations();
  const safeLabel = sanitizeFolderLabel(targetGroupLabel);
  const sourceSessionId = getCompressionSourceSessionId(sessionId) ?? sessionId;
  assertItemsAreNotPreserved(sessionId, sourceSessionId, itemIds);
  upsertFolder(sessionId, safeLabel, 'manual');

  for (const itemId of itemIds) {
    upsertDecisionLabel(sourceSessionId, itemId, safeLabel, true);
  }

  return getGroupingWorkspace(sessionId);
};

export const deleteGroupingItems = (sessionId: string, itemIds: string[]) => {
  runMigrations();

  if (itemIds.length === 0) {
    return getGroupingWorkspace(sessionId);
  }

  const db = getDb();
  const timestamp = nowIso();
  const sourceSessionId = getCompressionSourceSessionId(sessionId) ?? sessionId;
  const uniqueItemIds = Array.from(new Set(itemIds));
  assertItemsAreNotPreserved(sessionId, sourceSessionId, uniqueItemIds);

  db.exec('BEGIN TRANSACTION');

  try {
    for (const itemId of uniqueItemIds) {
      const item = db
        .prepare('SELECT id FROM media_items WHERE session_id = ? AND id = ?')
        .get(sourceSessionId, itemId) as { id: string } | undefined;

      if (!item) {
        continue;
      }

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
          ) VALUES (?, ?, ?, 0, 0, NULL, 1, ?)
          ON CONFLICT(session_id, item_id) DO UPDATE SET
            selected_for_output = 0,
            user_overridden = 1,
            updated_at = excluded.updated_at
        `
      ).run(randomUUID(), sourceSessionId, itemId, timestamp);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getGroupingWorkspace(sessionId);
};

export const listGroupingTemplates = () => {
  runMigrations();
  return getTemplateRows();
};

export const createGroupingTemplate = (payload: { name: string; pattern: string; enabled?: boolean }) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO grouping_folder_templates (id, name, pattern, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(randomUUID(), payload.name.trim(), payload.pattern.trim(), payload.enabled === false ? 0 : 1, timestamp, timestamp);

  return getTemplateRows();
};

export const updateGroupingTemplate = (
  templateId: string,
  payload: Partial<{ name: string; pattern: string; enabled: boolean }>
) => {
  runMigrations();
  const db = getDb();
  const current = db
    .prepare('SELECT id, name, pattern, enabled FROM grouping_folder_templates WHERE id = ?')
    .get(templateId) as { id: string; name: string; pattern: string; enabled: number } | undefined;

  if (!current) {
    return null;
  }

  db.prepare(
    `
      UPDATE grouping_folder_templates
      SET name = ?, pattern = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(
    payload.name?.trim() ?? current.name,
    payload.pattern?.trim() ?? current.pattern,
    typeof payload.enabled === 'boolean' ? (payload.enabled ? 1 : 0) : current.enabled,
    nowIso(),
    templateId
  );

  return getTemplateRows();
};

export const deleteGroupingTemplate = (templateId: string) => {
  runMigrations();
  const db = getDb();
  const result = db.prepare('DELETE FROM grouping_folder_templates WHERE id = ?').run(templateId);
  return result.changes > 0;
};

export const createFolderFromTemplate = (sessionId: string, templateId: string) => {
  runMigrations();
  const db = getDb();
  const template = db
    .prepare('SELECT name, pattern FROM grouping_folder_templates WHERE id = ? AND enabled = 1')
    .get(templateId) as { name: string; pattern: string } | undefined;

  if (!template) {
    return null;
  }

  const date = new Date();
  const formatted = formatDateLabel(date);
  const label = template.pattern
    .replaceAll('{year}', formatted.year)
    .replaceAll('{date}', formatted.tokenDate);

  return createGroupingFolder(sessionId, label || template.name, 'template');
};

const resolveCollision = (targetPath: string) => {
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);
  let index = 2;
  let candidate = path.join(directory, `${baseName} (${index})${extension}`);

  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = path.join(directory, `${baseName} (${index})${extension}`);
  }

  return candidate;
};

const removeEmptyDirectories = (directoryPath: string, rootPath: string) => {
  if (!isPathInside(rootPath, directoryPath) || normalizePath(directoryPath) === normalizePath(rootPath)) {
    return;
  }

  if (path.basename(directoryPath) === '.media-organizer') {
    return;
  }

  const entries = fs.existsSync(directoryPath) ? fs.readdirSync(directoryPath) : [];

  for (const entry of entries) {
    const child = path.join(directoryPath, entry);
    if (fs.statSync(child).isDirectory()) {
      removeEmptyDirectories(child, rootPath);
    }
  }

  const remaining = fs.existsSync(directoryPath) ? fs.readdirSync(directoryPath) : [];
  if (remaining.length === 0) {
    fs.rmdirSync(directoryPath);
  }
};

export const applyGroupingWorkspace = (sessionId: string) => {
  runMigrations();
  const db = getDb();
  const workspace = getGroupingWorkspace(sessionId);

  if (!workspace) {
    return null;
  }

  const timestamp = nowIso();
  const moved: Array<{ itemId: string; from: string; to: string }> = [];
  const deleted: Array<{ itemId: string; path: string }> = [];
  const sourceSessionId = workspace.compressionSessionId ?? sessionId;
  const deletedRows = listDeletedMediaRows(sourceSessionId);

  for (const row of deletedRows) {
    const deletedPath = getOutputPath(workspace.outputDir, row.relative_path);

    if (!isPathInside(workspace.outputDir, deletedPath)) {
      throw new Error('Refusing to delete media outside the destination folder.');
    }

    if (fs.existsSync(deletedPath)) {
      fs.rmSync(deletedPath, { force: true });
      deleted.push({ itemId: row.id, path: deletedPath });
    }

    db.prepare(
      `
        INSERT INTO item_stage_status (id, session_id, item_id, stage, status, attempt_count, last_error, updated_at)
        VALUES (?, ?, ?, 'group', 'skipped', 1, NULL, ?)
        ON CONFLICT(session_id, item_id, stage) DO UPDATE SET
          status = excluded.status,
          attempt_count = item_stage_status.attempt_count + 1,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `
    ).run(randomUUID(), sessionId, row.id, timestamp);
  }

  for (const item of workspace.items) {
    if (!item.targetGroupLabel) {
      if (!isPathInside(workspace.outputDir, item.outputPath)) {
        throw new Error('Refusing to keep media outside the destination folder.');
      }

      db.prepare(
        `
          INSERT INTO item_stage_status (id, session_id, item_id, stage, status, attempt_count, last_error, updated_at)
          VALUES (?, ?, ?, 'group', 'completed', 1, NULL, ?)
          ON CONFLICT(session_id, item_id, stage) DO UPDATE SET
            status = excluded.status,
            attempt_count = item_stage_status.attempt_count + 1,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `
      ).run(randomUUID(), sessionId, item.id, timestamp);
      continue;
    }

    const label = item.targetGroupLabel ? sanitizeFolderLabel(item.targetGroupLabel) : 'Sin fecha';
    const sourcePath = item.outputPath;
    const targetDirectory = path.join(workspace.outputDir, label);
    const targetPath = resolveCollision(path.join(targetDirectory, item.fileName));

    if (!isPathInside(workspace.outputDir, sourcePath) || !isPathInside(workspace.outputDir, targetPath)) {
      throw new Error('Refusing to move media outside the destination folder.');
    }

    fs.mkdirSync(targetDirectory, { recursive: true });

    if (!fs.existsSync(sourcePath)) {
      db.prepare(
        `
          INSERT INTO item_stage_status (id, session_id, item_id, stage, status, attempt_count, last_error, updated_at)
          VALUES (?, ?, ?, 'group', 'failed', 1, ?, ?)
          ON CONFLICT(session_id, item_id, stage) DO UPDATE SET
            status = excluded.status,
            attempt_count = item_stage_status.attempt_count + 1,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `
      ).run(randomUUID(), sessionId, item.id, 'Output file not found.', timestamp);
      continue;
    }

    if (normalizePath(sourcePath) !== normalizePath(targetPath)) {
      fs.renameSync(sourcePath, targetPath);
    }

    db.prepare(
      `
        INSERT INTO item_stage_status (id, session_id, item_id, stage, status, attempt_count, last_error, updated_at)
        VALUES (?, ?, ?, 'group', 'completed', 1, NULL, ?)
        ON CONFLICT(session_id, item_id, stage) DO UPDATE SET
          status = excluded.status,
          attempt_count = item_stage_status.attempt_count + 1,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `
    ).run(randomUUID(), sessionId, item.id, timestamp);

    db.prepare('UPDATE media_items SET relative_path = ?, updated_at = ? WHERE session_id = ? AND id = ?').run(
      path.relative(workspace.outputDir, targetPath),
      timestamp,
      sourceSessionId,
      item.id
    );

    moved.push({ itemId: item.id, from: sourcePath, to: targetPath });
  }

  for (const entry of fs.readdirSync(workspace.outputDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== '.media-organizer') {
      removeEmptyDirectories(path.join(workspace.outputDir, entry.name), workspace.outputDir);
    }
  }

  const failed = db
    .prepare("SELECT COUNT(*) AS total FROM item_stage_status WHERE session_id = ? AND stage = 'group' AND status = 'failed'")
    .get(sessionId) as { total: number };
  const completed = db
    .prepare("SELECT COUNT(*) AS total FROM item_stage_status WHERE session_id = ? AND stage = 'group' AND status IN ('completed', 'skipped')")
    .get(sessionId) as { total: number };
  const nextStatus = failed.total > 0 ? 'failed' : 'completed';
  const groupingManifest = getGroupingManifest(sessionId);

  db.prepare('UPDATE sessions SET status = ?, updated_at = ?, last_opened_at = ? WHERE id = ?').run(
    nextStatus,
    timestamp,
    timestamp,
    sessionId
  );

  db.prepare(
    `
      UPDATE session_checkpoints
      SET payload_json = ?, updated_at = ?
      WHERE session_id = ? AND stage = 'group'
    `
  ).run(
    JSON.stringify({
      outputRoot: workspace.outputDir,
      manifest: {
        ...(groupingManifest ?? {}),
        compressionSessionId: workspace.compressionSessionId,
        preservedDirectories: groupingManifest?.preservedDirectories ?? [],
        reorganizedDirectories: groupingManifest?.reorganizedDirectories ?? [],
        rules: groupingManifest?.rules ?? [],
        strategy: groupingManifest?.strategy ?? null,
        dateOptions: groupingManifest?.dateOptions ?? DEFAULT_DATE_OPTIONS,
        sourceFolderOptions: groupingManifest?.sourceFolderOptions ?? DEFAULT_SOURCE_FOLDER_OPTIONS
      },
      summary: {
        movedItems: moved.length,
        deletedItems: deleted.length,
        failedItems: failed.total
      }
    }),
    timestamp,
    sessionId
  );

  updateGroupingExecutionSummary({
    compressionSessionId: workspace.compressionSessionId,
    groupingSessionId: sessionId,
    status: nextStatus,
    totalItems: workspace.items.length + deletedRows.length,
    completedItems: completed.total,
    failedItems: failed.total,
    updatedAt: timestamp
  });

  const verification = nextStatus === 'completed'
    ? verifyGroupingWorkspaceDestination(sessionId, timestamp) ?? {
        status: 'not_verified' as const,
        expected: countWorkspaceItems(workspace.items),
        destination: createEmptyVerificationCounts(),
        verifiedAt: null,
        outputRoot: workspace.outputDir
      }
    : {
        status: 'not_verified' as const,
        expected: countWorkspaceItems(workspace.items),
        destination: createEmptyVerificationCounts(),
        verifiedAt: null,
        outputRoot: workspace.outputDir
      };

  updateExecutionVerification(workspace.compressionSessionId, verification);

  return {
    sessionId,
    status: nextStatus,
    movedItems: moved.length,
    deletedItems: deleted.length,
    failedItems: failed.total,
    sourceSessionId,
    verification
  };
};

export const getGroupingMediaPath = (sessionId: string, itemId: string) => {
  const workspace = getGroupingWorkspace(sessionId);

  if (!workspace) {
    return null;
  }

  const item = workspace.items.find((candidate) => candidate.id === itemId);

  if (!item || !MEDIA_EXTENSIONS.has(path.extname(item.outputPath).toLowerCase())) {
    return null;
  }

  if (!isPathInside(workspace.outputDir, item.outputPath)) {
    throw new Error('Refusing to read media outside the destination folder.');
  }

  return {
    path: item.outputPath,
    mediaType: item.mediaType
  };
};

const getPreviewFileName = (itemId: string) => `${itemId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;

const runImageMagick = (imageMagickCommand: string, args: string[]) =>
  spawnSync(imageMagickCommand, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32' && ['.cmd', '.bat'].includes(path.extname(imageMagickCommand).toLowerCase())
  });

const ensureHeicPreviewSupport = (imageMagickCommand: string) => {
  const result = runImageMagick(imageMagickCommand, ['identify', '-list', 'format']);

  if (result.error) {
    throw new GroupingPreviewError(`ImageMagick command not found: ${imageMagickCommand}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new GroupingPreviewError(stderr || 'Could not verify ImageMagick HEIC support.');
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.toUpperCase();

  if (!output.includes('HEIC') && !output.includes('HEIF')) {
    throw new GroupingPreviewError('ImageMagick is installed, but HEIC/HEIF support was not found. Install a build with libheif.');
  }
};

const generateHeicPreview = (imageMagickCommand: string, sourcePath: string, previewPath: string) => {
  ensureHeicPreviewSupport(imageMagickCommand);
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });

  const result = runImageMagick(imageMagickCommand, [
    sourcePath,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-resize',
    PREVIEW_MAX_SIZE,
    '-quality',
    PREVIEW_QUALITY,
    previewPath
  ]);

  if (result.error) {
    throw new GroupingPreviewError(`ImageMagick command not found: ${imageMagickCommand}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new GroupingPreviewError(stderr || 'Could not generate HEIC preview.');
  }
};

const isPreviewFresh = (sourcePath: string, previewPath: string) => {
  if (!fs.existsSync(previewPath)) {
    return false;
  }

  const sourceStats = fs.statSync(sourcePath);
  const previewStats = fs.statSync(previewPath);
  return previewStats.mtimeMs >= sourceStats.mtimeMs;
};

export const getGroupingPreviewPath = (sessionId: string, itemId: string) => {
  const workspace = getGroupingWorkspace(sessionId);

  if (!workspace) {
    return null;
  }

  const item = workspace.items.find((candidate) => candidate.id === itemId);

  if (!item || item.mediaType !== 'image') {
    return null;
  }

  const extension = path.extname(item.outputPath).toLowerCase();

  if (!IMAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  if (!isPathInside(workspace.outputDir, item.outputPath)) {
    throw new Error('Refusing to read media outside the destination folder.');
  }

  if (!fs.existsSync(item.outputPath)) {
    return null;
  }

  if (WEB_SAFE_IMAGE_EXTENSIONS.has(extension)) {
    return {
      path: item.outputPath,
      mediaType: item.mediaType
    };
  }

  if (!HEIC_EXTENSIONS.has(extension)) {
    return null;
  }

  const previewPath = path.join(workspace.outputDir, '.media-organizer', 'previews', sessionId, getPreviewFileName(item.id));

  if (!isPathInside(workspace.outputDir, previewPath)) {
    throw new Error('Refusing to write preview outside the destination folder.');
  }

  if (!isPreviewFresh(item.outputPath, previewPath)) {
    const compressionManifest = getCompressionManifest(workspace.compressionSessionId);
    const imageMagickCommand = compressionManifest?.imageMagickCommand?.trim() || 'magick';
    generateHeicPreview(imageMagickCommand, item.outputPath, previewPath);
  }

  return {
    path: previewPath,
    mediaType: item.mediaType
  };
};
