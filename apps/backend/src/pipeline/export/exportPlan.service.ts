import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../state/db.js';
import { parseMountedPath, parseUncPath } from './networkDestination.service.js';
import { isAlreadyCopied } from './networkExportFiles.js';
import { getNetworkExportGroupId, validateGroupIds, ExportScopeError } from './exportGroupIds.js';
import type { ExportItemRecord } from './export.types.js';
const INTERNAL_DIRECTORY_NAME = '.media-organizer';

export const normalizeExistingPath = (value: string) => path.resolve(value);

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

export const isPathInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

export const assertExistingSourceRoot = (sourceRoot: string) => {
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

const collectSourceExportFiles = (sourceRoot: string) => {
  assertExistingSourceRoot(sourceRoot);
  const resolvedSourceRoot = normalizeExistingPath(sourceRoot);
  const items: Array<{ sourcePath: string; relativePath: string; sizeBytes: number }> = [];
  const walk = (directoryPath: string) => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (entry.name === INTERNAL_DIRECTORY_NAME) continue;
      const sourcePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) { walk(sourcePath); continue; }
      if (!entry.isFile()) continue;
      items.push({ sourcePath, relativePath: path.relative(resolvedSourceRoot, sourcePath), sizeBytes: fs.statSync(sourcePath).size });
    }
  };
  walk(resolvedSourceRoot);
  return items;
};

export const collectExportFilePlan = (sourceRoot: string, destinationRoot: string) => {
  const resolvedDestinationRoot = normalizeExistingPath(destinationRoot);
  return collectSourceExportFiles(sourceRoot).map((item) => ({
    ...item, destinationPath: path.join(resolvedDestinationRoot, item.relativePath)
  }));
};

export const collectGooglePhotosFilePlan = (sourceRoot: string) => collectSourceExportFiles(sourceRoot).map((item) => {
  const albumTitle = getGooglePhotosAlbumTitleForRelativePath(item.relativePath);
  return { ...item, destinationPath: albumTitle, albumTitle, supported: isGooglePhotosSupportedFile(item.sourcePath) };
});

const getNetworkRows = (sourceRoot: string, destinationPath: string, executionId: string | null) => {
  const rows = getDb().prepare(`
    SELECT i.*, j.target_path
    FROM export_items i JOIN export_jobs j ON j.id = i.job_id
    WHERE j.target_type = 'network-folder' AND j.source_root = ?
      AND (j.execution_id = ? OR (j.execution_id IS NULL AND ? IS NULL))
    ORDER BY datetime(i.updated_at) DESC, i.rowid DESC
  `).all(sourceRoot, executionId, executionId) as Array<NetworkItemRow>;
  const destination = normalizeNetworkDestinationPathForComparison(destinationPath);
  return rows.filter((row) => row.target_path && normalizeNetworkDestinationPathForComparison(row.target_path) === destination);
};

export type NetworkItemRow = {
  id: string; job_id: string; source_path: string; relative_path: string;
  destination_path: string; size_bytes: number; status: ExportItemRecord['status'];
  last_error: string | null; updated_at: string; attempt_count: number; target_path?: string;
};

export const toExportItem = (row: NetworkItemRow): ExportItemRecord => ({
  id: row.id, jobId: row.job_id, sourcePath: row.source_path, relativePath: row.relative_path,
  destinationPath: row.destination_path, sizeBytes: row.size_bytes, status: row.status,
  lastError: row.last_error, updatedAt: row.updated_at, attemptCount: row.attempt_count
});

export const getVerifiedNetworkHistory = (sourceRoot: string, destinationPath: string, executionId: string | null) => {
  const states = new Map<string, ExportItemRecord>();
  for (const row of getNetworkRows(sourceRoot, destinationPath, executionId)) {
    if (states.has(row.source_path)) continue;
    const item = toExportItem(row);
    if (item.status === 'completed' || item.status === 'skipped') {
      try {
        if (!isAlreadyCopied(item)) { item.status = 'pending'; item.lastError = null; }
      } catch { item.status = 'pending'; item.lastError = null; }
    }
    states.set(row.source_path, item);
  }
  return states;
};

export const filterNetworkExportPlan = <T extends { relativePath: string }>(items: T[], groupIds?: string[]) => {
  if (groupIds === undefined) return items;
  validateGroupIds(groupIds);
  const available = new Set(items.map((item) => getNetworkExportGroupId(item.relativePath)));
  if (groupIds.some((id) => !available.has(id))) throw new ExportScopeError('Unknown export group.');
  const selected = new Set(groupIds);
  return items.filter((item) => selected.has(getNetworkExportGroupId(item.relativePath)));
};

