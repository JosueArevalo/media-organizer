import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

type OrientedJpegHelperRuntime = {
  command: string;
  scriptPath: string;
  runAsNode: boolean;
};

type OrientedJpegHelperRuntimeOptions = {
  currentFile?: string;
  execPath?: string;
  platform?: NodeJS.Platform;
  versions?: NodeJS.ProcessVersions;
};

export const resolveOrientedJpegHelperRuntime = (
  options: OrientedJpegHelperRuntimeOptions = {}
): OrientedJpegHelperRuntime => {
  const moduleFile = options.currentFile ?? currentFile;
  const moduleDir = path.dirname(moduleFile);
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const versions = options.versions ?? process.versions;
  const repoRootDir = path.resolve(moduleDir, '../../../../..');
  const isSourceRuntime = moduleFile.includes(`${path.sep}src${path.sep}`);

  return {
    command: isSourceRuntime
      ? path.join(repoRootDir, 'node_modules', '.bin', platform === 'win32' ? 'tsx.cmd' : 'tsx')
      : execPath,
    scriptPath: path.join(moduleDir, isSourceRuntime ? 'orientedJpegCompression.cli.ts' : 'orientedJpegCompression.cli.js'),
    runAsNode: !isSourceRuntime && Boolean(versions.electron)
  };
};

export const getOrientedJpegHelperCommand = () => resolveOrientedJpegHelperRuntime().command;

export const getOrientedJpegHelperScriptPath = () => resolveOrientedJpegHelperRuntime().scriptPath;

export const shouldRunOrientedJpegHelperAsNode = () => resolveOrientedJpegHelperRuntime().runAsNode;
