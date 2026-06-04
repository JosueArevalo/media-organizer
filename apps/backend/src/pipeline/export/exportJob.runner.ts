import fs from 'node:fs';
import path from 'node:path';
import {
  getExportJob,
  getExportJobStatus,
  listRunnableExportItems,
  markExportItemRunning,
  markExportJobRunning,
  persistExportItemResult,
  resetInvalidCompletedExportItems,
  resetRunningExportItems,
  refreshExportJobCounters
} from './exportJob.service.js';
import type { ExportItemRecord } from './export.types.js';
import { executeGooglePhotosExportJob } from './googlePhotosExport.runner.js';

const isAlreadyCopied = (item: ExportItemRecord) => {
  if (!fs.existsSync(item.destinationPath)) {
    return false;
  }

  const sourceStats = fs.statSync(item.sourcePath);
  const destinationStats = fs.statSync(item.destinationPath);

  if (sourceStats.size !== destinationStats.size) {
    return false;
  }

  return fs.readFileSync(item.sourcePath).equals(fs.readFileSync(item.destinationPath));
};

const copyExportItem = (item: ExportItemRecord) => {
  const sourceStats = fs.statSync(item.sourcePath);
  const tempPath = path.join(
    path.dirname(item.destinationPath),
    `.${path.basename(item.destinationPath)}.media-organizer-tmp-${process.pid}-${Date.now()}`
  );

  fs.mkdirSync(path.dirname(item.destinationPath), { recursive: true });
  try {
    fs.copyFileSync(item.sourcePath, tempPath);
    fs.utimesSync(tempPath, sourceStats.atime, sourceStats.mtime);
    fs.renameSync(tempPath, item.destinationPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  if (!isAlreadyCopied(item)) {
    throw new Error('Copied file verification failed.');
  }
};

const yieldToEventLoop = async () => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

export const executeExportJob = async (jobId: string) => {
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    throw new Error('Export job not found.');
  }

  if (snapshot.job.targetType === 'google-photos') {
    return executeGooglePhotosExportJob(jobId);
  }

  if (snapshot.job.targetType !== 'network-folder') {
    throw new Error('Unsupported export job target.');
  }

  markExportJobRunning(jobId);
  await yieldToEventLoop();

  resetRunningExportItems(jobId);
  resetInvalidCompletedExportItems(jobId, isAlreadyCopied);
  refreshExportJobCounters(jobId, 'running');

  const items = listRunnableExportItems(jobId);

  if (items.length === 0) {
    return refreshExportJobCounters(jobId, 'completed');
  }

  for (const item of items.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    sourcePath: row.source_path,
    relativePath: row.relative_path,
    destinationPath: row.destination_path,
    sizeBytes: row.size_bytes,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    updatedAt: row.updated_at
  } satisfies ExportItemRecord))) {
    const currentStatus = getExportJobStatus(jobId);

    if (currentStatus === 'paused' || currentStatus === 'cancelled') {
      return refreshExportJobCounters(jobId, currentStatus);
    }

    try {
      if (isAlreadyCopied(item)) {
        persistExportItemResult(item.id, 'skipped', null, item.relativePath);
      } else {
        markExportItemRunning(item.id, item.relativePath);
        copyExportItem(item);
        persistExportItemResult(item.id, 'completed', null, item.relativePath);
      }
    } catch (error) {
      persistExportItemResult(item.id, 'failed', error instanceof Error ? error.message : 'Could not copy file.', item.relativePath);
    }

    refreshExportJobCounters(jobId);
    await yieldToEventLoop();

    const statusAfterItem = getExportJobStatus(jobId);
    if (statusAfterItem === 'paused' || statusAfterItem === 'cancelled') {
      return refreshExportJobCounters(jobId, statusAfterItem);
    }
  }

  return refreshExportJobCounters(jobId);
};
