import type { CompressionSessionSnapshot } from './compression-job.store';
import type { ExportJobSnapshot } from './export-job.store';

export const hasCompressionSessionStarted = (snapshot: CompressionSessionSnapshot) =>
  Boolean(snapshot.backendSessionId) || snapshot.status !== 'idle';

export const isPreCompressionStepReadOnly = (snapshot: CompressionSessionSnapshot) =>
  hasCompressionSessionStarted(snapshot);

export const isGroupingReadOnlyForExport = (snapshots: ExportJobSnapshot[]) =>
  snapshots.some((snapshot) => snapshot.status === 'running' || snapshot.status === 'paused');
