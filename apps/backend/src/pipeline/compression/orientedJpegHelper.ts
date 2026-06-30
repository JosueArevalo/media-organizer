import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRootDir = path.resolve(currentDir, '../../../../..');
const sourceHelperPath = path.join(repoRootDir, 'apps', 'backend', 'src', 'pipeline', 'compression', 'orientedJpegCompression.cli.ts');
const distHelperPath = path.join(repoRootDir, 'apps', 'backend', 'dist', 'pipeline', 'compression', 'orientedJpegCompression.cli.js');
const isSourceRuntime = currentFile.includes(`${path.sep}src${path.sep}`);

export const getOrientedJpegHelperCommand = () =>
  isSourceRuntime
    ? path.join(repoRootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
    : process.execPath;

export const getOrientedJpegHelperScriptPath = () => (isSourceRuntime ? sourceHelperPath : distHelperPath);
