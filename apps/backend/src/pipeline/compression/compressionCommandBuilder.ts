import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompressionJobManifest } from './compressionJob.service.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRootDir = path.resolve(currentDir, '../../../../..');

export const getCompressionScriptsDir = () => path.join(repoRootDir, 'scripts', 'media_tools');

export const getPythonCommand = () => process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';

export const buildImageCompressionCommand = (manifest: CompressionJobManifest) => ({
  command: getPythonCommand(),
  args: [
    path.join(getCompressionScriptsDir(), 'compress_images.py'),
    '--source-dir',
    manifest.sourceDir,
    '--output-dir',
    manifest.imageOutputDir,
    '--quality',
    String(manifest.imageQuality),
    '--encoder-command',
    manifest.imageToolCommand,
    '--selection-scope-json',
    JSON.stringify(manifest.selectionScope)
  ]
});

export const buildVideoCompressionCommand = (manifest: CompressionJobManifest) => ({
  command: getPythonCommand(),
  args: [
    path.join(getCompressionScriptsDir(), 'compress_videos.py'),
    '--source-dir',
    manifest.sourceDir,
    '--output-dir',
    manifest.videoOutputDir,
    '--preset',
    manifest.videoPresetLabel,
    '--encoder-command',
    manifest.videoToolCommand,
    '--selection-scope-json',
    JSON.stringify(manifest.selectionScope)
  ]
});