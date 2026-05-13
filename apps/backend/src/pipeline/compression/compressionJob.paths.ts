import path from 'node:path';

/**
 * Build the root output directory for compression.
 * Output now mirrors the source tree directly under the selected destination.
 */
export const buildCompressionSessionOutputRoot = (outputDir: string): string => outputDir;

export const buildCompressionSessionManifestPath = (outputRoot: string) => path.join(outputRoot, '.media-organizer', 'session.json');

export const buildCompressionImagesOutputDir = (outputRoot: string) => outputRoot;

export const buildCompressionVideosOutputDir = (outputRoot: string) => outputRoot;