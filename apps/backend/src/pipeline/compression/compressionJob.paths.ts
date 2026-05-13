import path from 'node:path';

/**
 * Build the root output directory for compression.
 * No longer nested under /jobs/sessionId; output goes directly to output_dir.
 */
export const buildCompressionSessionOutputRoot = (outputDir: string): string => outputDir;

export const buildCompressionSessionManifestPath = (outputRoot: string) => path.join(outputRoot, '.media-organizer', 'session.json');

export const buildCompressionImagesOutputDir = (outputRoot: string) => path.join(outputRoot, 'images');

export const buildCompressionVideosOutputDir = (outputRoot: string) => path.join(outputRoot, 'videos');