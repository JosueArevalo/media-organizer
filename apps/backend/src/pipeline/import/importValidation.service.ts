import fs from 'node:fs/promises';
import path from 'node:path';

export type ImportFolderValidationCode =
  | 'missing_paths'
  | 'relative_source'
  | 'relative_destination'
  | 'same_path'
  | 'destination_inside_source'
  | 'source_not_found'
  | 'source_not_directory'
  | 'source_not_readable'
  | 'destination_parent_not_found'
  | 'destination_not_directory'
  | 'destination_not_empty'
  | 'destination_not_writable';

export type ImportFolderValidationResult =
  | { ok: true }
  | { ok: false; code: ImportFolderValidationCode; message: string; entryCount?: number };

const normalizeForComparison = (value: string) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const isPathInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const findExistingAncestor = async (targetPath: string): Promise<string | null> => {
  let currentPath = path.resolve(targetPath);

  while (true) {
    try {
      await fs.stat(currentPath);
      return currentPath;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
};

export const validateImportFolders = async (
  sourcePathValue: string,
  destinationPathValue: string
): Promise<ImportFolderValidationResult> => {
  const sourcePath = sourcePathValue.trim();
  const destinationPath = destinationPathValue.trim();

  if (!sourcePath || !destinationPath) {
    return {
      ok: false,
      code: 'missing_paths',
      message: 'Source and Destination paths are required.'
    };
  }

  if (!path.isAbsolute(sourcePath)) {
    return {
      ok: false,
      code: 'relative_source',
      message: 'Source path must be an absolute path.'
    };
  }

  if (!path.isAbsolute(destinationPath)) {
    return {
      ok: false,
      code: 'relative_destination',
      message: 'Destination path must be an absolute path.'
    };
  }

  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestination = path.resolve(destinationPath);
  const comparableSource = normalizeForComparison(resolvedSource);
  const comparableDestination = normalizeForComparison(resolvedDestination);

  if (comparableSource === comparableDestination) {
    return {
      ok: false,
      code: 'same_path',
      message: 'Source and Destination cannot be the same folder.'
    };
  }

  if (isPathInside(comparableSource, comparableDestination)) {
    return {
      ok: false,
      code: 'destination_inside_source',
      message: 'Destination cannot be inside the Source folder.'
    };
  }

  let sourceStats;

  try {
    sourceStats = await fs.stat(resolvedSource);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    return {
      ok: false,
      code: code === 'ENOENT' || code === 'ENOTDIR' ? 'source_not_found' : 'source_not_readable',
      message: code === 'ENOENT' || code === 'ENOTDIR'
        ? 'Source folder does not exist.'
        : 'Source folder cannot be read.'
    };
  }

  if (!sourceStats.isDirectory()) {
    return {
      ok: false,
      code: 'source_not_directory',
      message: 'Source path must be a folder.'
    };
  }

  try {
    await fs.access(resolvedSource, fs.constants.R_OK);
  } catch {
    return {
      ok: false,
      code: 'source_not_readable',
      message: 'Source folder cannot be read.'
    };
  }

  try {
    const destinationStats = await fs.stat(resolvedDestination);

    if (!destinationStats.isDirectory()) {
      return {
        ok: false,
        code: 'destination_not_directory',
        message: 'Destination path exists but is not a folder.'
      };
    }

    await fs.access(resolvedDestination, fs.constants.W_OK);
    const destinationEntries = await fs.readdir(resolvedDestination);

    if (destinationEntries.length > 0) {
      return {
        ok: false,
        code: 'destination_not_empty',
        message: 'Destination folder is not empty.',
        entryCount: destinationEntries.length
      };
    }

    return { ok: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      return {
        ok: false,
        code: 'destination_not_writable',
        message: 'Destination folder cannot be written.'
      };
    }
  }

  const existingAncestor = await findExistingAncestor(resolvedDestination);

  if (!existingAncestor) {
    return {
      ok: false,
      code: 'destination_parent_not_found',
      message: 'Destination parent folder does not exist.'
    };
  }

  try {
    const ancestorStats = await fs.stat(existingAncestor);

    if (!ancestorStats.isDirectory()) {
      return {
        ok: false,
        code: 'destination_parent_not_found',
        message: 'Destination parent folder does not exist.'
      };
    }

    await fs.access(existingAncestor, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      code: 'destination_not_writable',
      message: 'Destination parent folder cannot be written.'
    };
  }

  return { ok: true };
};
