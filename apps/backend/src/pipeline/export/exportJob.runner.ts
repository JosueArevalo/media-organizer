import fs from 'node:fs';
import path from 'node:path';
import {
  getExportJob,
  getExportJobStatus,
  listRunnableExportItems,
  markExportJobRunning,
  persistExportItemResult,
  refreshExportJobCounters
} from './exportJob.service.js';
import type { ExportItemRecord } from './export.types.js';

const isAlreadyCopied = (item: ExportItemRecord) => {
  if (!fs.existsSync(item.destinationPath)) {
    return false;
  }

  const sourceStats = fs.statSync(item.sourcePath);
  const destinationStats = fs.statSync(item.destinationPath);
  const sourceTime = Math.floor(sourceStats.mtimeMs);
  const destinationTime = Math.floor(destinationStats.mtimeMs);

  return sourceStats.size === destinationStats.size && Math.abs(sourceTime - destinationTime) < 2000;
};

const copyExportItem = (item: ExportItemRecord) => {
  const sourceStats = fs.statSync(item.sourcePath);

  fs.mkdirSync(path.dirname(item.destinationPath), { recursive: true });
  fs.copyFileSync(item.sourcePath, item.destinationPath);
  fs.utimesSync(item.destinationPath, sourceStats.atime, sourceStats.mtime);
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

  if (snapshot.job.targetType !== 'network-folder') {
    throw new Error('Only network-folder export jobs can be executed in this MVP.');
  }

  markExportJobRunning(jobId);
  await yieldToEventLoop();

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
        copyExportItem(item);
        persistExportItemResult(item.id, 'completed', null, item.relativePath);
      }
    } catch (error) {
      persistExportItemResult(item.id, 'failed', error instanceof Error ? error.message : 'Could not copy file.', item.relativePath);
    }

    refreshExportJobCounters(jobId);
    await yieldToEventLoop();
  }

  return refreshExportJobCounters(jobId);
};
