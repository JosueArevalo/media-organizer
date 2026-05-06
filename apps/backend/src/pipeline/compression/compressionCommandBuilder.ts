import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompressionJobManifest } from './compressionJob.service.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRootDir = path.resolve(currentDir, '../../../../..');

export const getCompressionScriptsDir = () => path.join(repoRootDir, 'scripts', 'media_tools');

export const buildImageCompressionCommand = (manifest: CompressionJobManifest) => ({
  command: manifest.imageToolCommand,
  args: [
    path.join(getCompressionScriptsDir(), 'compress_images.py'),
    '--source-dir',
    manifest.sourceDir,
    '--output-dir',
    manifest.imageOutputDir,
    '--quality',
    String(manifest.imageQuality)
  ]
});

export const buildVideoCompressionCommand = (manifest: CompressionJobManifest) => ({
  command: manifest.videoToolCommand,
  args: [
    path.join(getCompressionScriptsDir(), 'compress_videos.py'),
    '--source-dir',
    manifest.sourceDir,
    '--output-dir',
    manifest.videoOutputDir
  ]
});