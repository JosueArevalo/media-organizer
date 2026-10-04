import path from 'node:path';

// Stable group identifiers are data, never translated labels or destination paths.
export const getNetworkExportGroupId = (relativePath: string, separator = path.sep) => {
  const segments = relativePath.split(separator);
  return segments.length > 1 ? `folder:${segments[0]}` : 'root:';
};

export const getGooglePhotosExportGroupId = (albumTitle: string) => `album:${albumTitle}`;

export class ExportScopeError extends Error {}

export function validateGroupIds(groupIds: unknown): asserts groupIds is string[] {
  if (!Array.isArray(groupIds) || groupIds.some((id) => typeof id !== 'string' || !id)) {
    throw new ExportScopeError('groupIds must be an array of nonempty strings.');
  }
}
