import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = path.resolve(os.tmpdir());
const tempRootPrefix = `${tempRoot}${path.sep}`;
const trackedDirectories = new Set<string>();

const assertSafeTestTempPath = (directory: string) => {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(tempRootPrefix) || !path.basename(resolved).startsWith('media-organizer-')) {
    throw new Error(`Refusing to clean an unsafe test temporary directory: ${resolved}`);
  }
  return resolved;
};

export const createTrackedTestTempDirectory = (prefix: string) => {
  if (!prefix.startsWith('media-organizer-') || !prefix.endsWith('-') || path.basename(prefix) !== prefix) {
    throw new Error(`Invalid Media Organizer test temporary prefix: ${prefix}`);
  }

  const directory = assertSafeTestTempPath(fs.mkdtempSync(path.join(tempRoot, prefix)));
  trackedDirectories.add(directory);
  return directory;
};

export const cleanupTrackedTestTempDirectory = (directory: string) => {
  const resolved = assertSafeTestTempPath(directory);
  if (!trackedDirectories.has(resolved)) {
    throw new Error(`Refusing to clean an untracked test temporary directory: ${resolved}`);
  }

  fs.rmSync(resolved, { recursive: true, force: true });
  trackedDirectories.delete(resolved);
};

export const cleanupTrackedTestTempDirectories = () => {
  for (const directory of [...trackedDirectories].reverse()) {
    cleanupTrackedTestTempDirectory(directory);
  }
};
