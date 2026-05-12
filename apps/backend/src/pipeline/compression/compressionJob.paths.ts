import path from 'node:path';

export const buildCompressionJobOutputRoot = (outputDir: string, jobId: string) =>
  path.join(outputDir, 'media-organizer', 'jobs', jobId);

export const buildCompressionJobManifestPath = (outputRoot: string) => path.join(outputRoot, 'compression-job.json');

export const buildCompressionImagesOutputDir = (outputRoot: string) => path.join(outputRoot, 'compressed', 'images');

export const buildCompressionVideosOutputDir = (outputRoot: string) => path.join(outputRoot, 'compressed', 'videos');