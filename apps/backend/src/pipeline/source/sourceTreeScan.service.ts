import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

type ScannedFile = {
  kind: 'file';
  name: string;
  path: string;
  depth: number;
  sizeBytes: number;
  fileType: string;
};

type ScannedDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  depth: number;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  children: Array<ScannedDirectory | ScannedFile>;
};

const toUnixPath = (value: string) => value.replace(/\\/g, '/');

const getFileType = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(extension)) {
    return 'Image';
  }

  if (['mp4', 'mov', 'm4v', 'avi', 'mkv'].includes(extension)) {
    return 'Video';
  }

  if (['pdf', 'doc', 'docx', 'txt'].includes(extension)) {
    return 'Document';
  }

  return 'File';
};

const scanDirectory = async (
  absoluteDirPath: string,
  rootAbsolutePath: string,
  depth: number
): Promise<ScannedDirectory> => {
  const entries = await readdir(absoluteDirPath, { withFileTypes: true });
  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  const relativeFromRoot = toUnixPath(absoluteDirPath).slice(toUnixPath(rootAbsolutePath).length).replace(/^\//, '');
  const logicalPath = relativeFromRoot ? `${basename(rootAbsolutePath)}/${relativeFromRoot}` : basename(rootAbsolutePath);

  const children: Array<ScannedDirectory | ScannedFile> = [];
  let sizeBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;

  for (const entry of entries) {
    const entryAbsolutePath = join(absoluteDirPath, entry.name);

    if (entry.isDirectory()) {
      const childDir = await scanDirectory(entryAbsolutePath, rootAbsolutePath, depth + 1);
      children.push(childDir);
      sizeBytes += childDir.sizeBytes;
      fileCount += childDir.fileCount;
      directoryCount += 1 + childDir.directoryCount;
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStats = await stat(entryAbsolutePath);
    const fileRelativeFromRoot = toUnixPath(entryAbsolutePath)
      .slice(toUnixPath(rootAbsolutePath).length)
      .replace(/^\//, '');

    children.push({
      kind: 'file',
      name: entry.name,
      path: `${basename(rootAbsolutePath)}/${fileRelativeFromRoot}`,
      depth: depth + 1,
      sizeBytes: fileStats.size,
      fileType: getFileType(entry.name)
    });

    sizeBytes += fileStats.size;
    fileCount += 1;
  }

  return {
    kind: 'directory',
    name: basename(absoluteDirPath),
    path: logicalPath,
    depth,
    sizeBytes,
    fileCount,
    directoryCount,
    children
  };
};

export const scanSourceTreeByPath = async (sourcePath: string): Promise<ScannedDirectory> => {
  const rootStats = await stat(sourcePath);

  if (!rootStats.isDirectory()) {
    throw new Error('Source path must be a directory.');
  }

  return scanDirectory(sourcePath, sourcePath, 0);
};
