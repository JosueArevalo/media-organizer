import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompressionSessionManifest } from './compressionJob.service.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRootDir = path.resolve(currentDir, '../../../../..');

export const getCompressionScriptsDir = () => path.join(repoRootDir, 'scripts', 'media_tools');

export const getPythonCommand = () => process.env.MEDIA_ORGANIZER_PYTHON_COMMAND ?? 'python';

type ResumeItem = {
  source: string;
  output: string;
};

type ResumePhase = 'images' | 'videos';

const writeResumeSkipFile = (manifest: CompressionSessionManifest, phase: ResumePhase, resumeItems: ResumeItem[]) => {
  const metadataDir = path.join(manifest.outputRoot, '.media-organizer');
  fs.mkdirSync(metadataDir, { recursive: true });

  const filePath = path.join(metadataDir, `resume-skip-${phase}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(resumeItems)}\n`, 'utf8');

  return filePath;
};

const appendResumeArgs = (args: string[], manifest: CompressionSessionManifest, phase: ResumePhase, resumeItems?: ResumeItem[]) => {
  if (!resumeItems?.length) {
    return args;
  }

  return [
    ...args,
    '--resume-skip-file',
    writeResumeSkipFile(manifest, phase, resumeItems)
  ];
};

export const buildImageCompressionCommand = (manifest: CompressionSessionManifest, resumeItems?: ResumeItem[]) => ({
  command: getPythonCommand(),
  args: appendResumeArgs([
    path.join(getCompressionScriptsDir(), 'compress_images.py'),
    '--source-dir',
    manifest.sourceDir,
    '--output-dir',
    manifest.imageOutputDir,
    '--quality',
    String(manifest.imageQuality),
    '--encoder-command',
    manifest.imageToolCommand,
    '--imagemagick-command',
    manifest.imageMagickCommand,
    '--exiftool-command',
    manifest.exifToolCommand,
    '--selection-scope-json',
    JSON.stringify(manifest.selectionScope)
  ], manifest, 'images', resumeItems)
});

export const buildVideoCompressionCommand = (manifest: CompressionSessionManifest, resumeItems?: ResumeItem[]) => ({
  command: getPythonCommand(),
  args: appendResumeArgs([
    path.join(getCompressionScriptsDir(), 'compress_videos.py'),
    '--source-dir',
    manifest.sourceDir,
    '--output-dir',
    manifest.videoOutputDir,
    '--preset',
    manifest.videoPresetLabel,
    '--output-format-mode',
    manifest.videoOutputFormatMode,
    '--encoder-command',
    manifest.videoToolCommand,
    '--selection-scope-json',
    JSON.stringify(manifest.selectionScope)
  ], manifest, 'videos', resumeItems)
});
