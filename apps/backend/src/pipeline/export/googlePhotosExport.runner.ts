import path from 'node:path';
import {
  invalidateCachedGooglePhotosAlbumById,
  invalidateCachedGooglePhotosAlbumByTitle,
  isGooglePhotosAlbumMissingError,
  createGooglePhotosMediaItems,
  ensureGooglePhotosItemMetadata,
  getOrCreateGooglePhotosAlbum,
  inferGooglePhotosContentType,
  isUploadTokenFresh,
  redactGooglePhotosUploadToken,
  updateGooglePhotosItemCreated,
  updateGooglePhotosItemUploaded,
  uploadGooglePhotosMedia
} from './googlePhotosApi.service.js';
import {
  appendExportJobNotice,
  getExportJob,
  getExportJobStatus,
  listRunnableExportItems,
  markExportItemRunning,
  markExportJobRunning,
  persistExportItemResult,
  resetRunningExportItems,
  refreshExportJobCounters
} from './exportJob.service.js';
import type { ExportItemRecord } from './export.types.js';
import type { GooglePhotosBatchCreateResult } from './googlePhotos.types.js';

const batchSize = 1;
const GOOGLE_PHOTOS_LOG_PREFIX = '[google-photos]';

const yieldToEventLoop = async () => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

const getAccountId = (payloadJson: string | null) => {
  if (!payloadJson) {
    throw new Error('Google Photos export target metadata is missing.');
  }

  const payload = JSON.parse(payloadJson) as { target?: { type?: string; accountId?: string } };

  if (payload.target?.type !== 'google-photos' || !payload.target.accountId) {
    throw new Error('Google Photos export target metadata is invalid.');
  }

  return payload.target.accountId;
};

const toItemRecord = (row: {
  id: string;
  job_id: string;
  source_path: string;
  relative_path: string;
  destination_path: string;
  size_bytes: number;
  status: ExportItemRecord['status'];
  attempt_count: number;
  last_error: string | null;
  updated_at: string;
}): ExportItemRecord => ({
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
});

const serializeGooglePhotosStatusDetails = (details: unknown) => {
  if (!details) {
    return null;
  }

  try {
    const serialized = JSON.stringify(details);
    return serialized.length > 1000 ? `${serialized.slice(0, 1000)}...` : serialized;
  } catch {
    return 'Could not serialize Google Photos status details.';
  }
};

const formatGooglePhotosBatchCreateError = (
  result: GooglePhotosBatchCreateResult | undefined,
  albumId: string,
  queued: { item: ExportItemRecord; uploadToken: string }
) => {
  const status = result?.status;
  const details = serializeGooglePhotosStatusDetails(status?.details);
  const parts = ['Google Photos rejected media item.'];

  if (typeof status?.code === 'number') {
    parts.push(`Code: ${status.code}.`);
  }

  if (status?.message) {
    parts.push(`Message: ${status.message.replace(/\.+$/, '')}.`);
  } else {
    parts.push('Message: Google Photos did not create this media item.');
  }

  if (details) {
    parts.push(`Details: ${details}.`);
  }

  parts.push(`Album: ${queued.item.destinationPath}.`);
  parts.push(`Album ID: ${albumId}.`);
  parts.push(`File: ${path.basename(queued.item.sourcePath)}.`);
  parts.push(`Size: ${queued.item.sizeBytes} bytes.`);
  parts.push(`Inferred Content-Type: ${inferGooglePhotosContentType(queued.item.sourcePath)}.`);
  parts.push(`Upload token: ${redactGooglePhotosUploadToken(queued.uploadToken)}.`);

  return parts.join(' ');
};

const createUploadedBatch = async (
  accountId: string,
  albumId: string,
  items: Array<{ item: ExportItemRecord; uploadToken: string; uploadCreatedAt: string }>
) => {
  const results = await createGooglePhotosMediaItems(
    accountId,
    albumId,
    items.map(({ item, uploadToken }) => ({
      uploadToken,
      fileName: path.basename(item.sourcePath)
    }))
  );

  for (const queued of items) {
    const result = results.find((candidate) => candidate.uploadToken === queued.uploadToken);

    if (result?.mediaItem?.id) {
      updateGooglePhotosItemCreated(queued.item.id, result.mediaItem.id, result.mediaItem.productUrl ?? null);
      persistExportItemResult(queued.item.id, 'completed', null, queued.item.relativePath);
      continue;
    }

    const message = formatGooglePhotosBatchCreateError(result, albumId, queued);
    console.warn(`${GOOGLE_PHOTOS_LOG_PREFIX} ${message}`);
    persistExportItemResult(queued.item.id, 'failed', message, queued.item.relativePath);
  }
};

export const executeGooglePhotosExportJob = async (jobId: string) => {
  const snapshot = getExportJob(jobId);

  if (!snapshot) {
    throw new Error('Export job not found.');
  }

  if (snapshot.job.targetType !== 'google-photos') {
    throw new Error('Only google-photos export jobs can be executed by this runner.');
  }

  const accountId = getAccountId(snapshot.checkpoint?.payloadJson ?? null);
  resetRunningExportItems(jobId);
  markExportJobRunning(jobId);
  await yieldToEventLoop();
  refreshExportJobCounters(jobId, 'running');

  const rows = listRunnableExportItems(jobId);

  if (rows.length === 0) {
    return refreshExportJobCounters(jobId, 'completed');
  }

  const pendingByAlbum = new Map<string, Array<{ item: ExportItemRecord; uploadToken: string; uploadCreatedAt: string }>>();

  const flushAlbum = async (albumId: string) => {
    const queued = pendingByAlbum.get(albumId) ?? [];
    let currentAlbumId = albumId;
    let hasRetriedMissingAlbum = false;

    while (queued.length > 0) {
      const currentStatus = getExportJobStatus(jobId);

      if (currentStatus === 'paused' || currentStatus === 'cancelled') {
        return false;
      }

      const batchItems = queued.splice(0, batchSize);

      try {
        await createUploadedBatch(accountId, currentAlbumId, batchItems);
      } catch (error) {
        if (!hasRetriedMissingAlbum && isGooglePhotosAlbumMissingError(error)) {
          const albumTitle = batchItems[0]?.item.destinationPath ?? queued[0]?.item.destinationPath;

          if (!albumTitle) {
            throw error;
          }

          hasRetriedMissingAlbum = true;
          invalidateCachedGooglePhotosAlbumById(accountId, currentAlbumId);
          invalidateCachedGooglePhotosAlbumByTitle(accountId, albumTitle);
          const recreatedAlbum = await getOrCreateGooglePhotosAlbum(accountId, albumTitle);
          currentAlbumId = recreatedAlbum.googleAlbumId;

          for (const queuedItem of [...batchItems, ...queued]) {
            updateGooglePhotosItemUploaded(
              queuedItem.item.id,
              recreatedAlbum.googleAlbumId,
              queuedItem.uploadToken,
              queuedItem.uploadCreatedAt
            );
          }

          pendingByAlbum.delete(albumId);
          pendingByAlbum.set(recreatedAlbum.googleAlbumId, queued);
          queued.unshift(...batchItems);

          const notice = `google-photos-album-recreated:${albumTitle}`;
          appendExportJobNotice(jobId, notice);
          console.warn(
            `${GOOGLE_PHOTOS_LOG_PREFIX} Google Photos album "${albumTitle}" no longer existed remotely. Media Organizer recreated it automatically and continued the upload.`
          );
          continue;
        }

        throw error;
      }

      refreshExportJobCounters(jobId);
      await yieldToEventLoop();

      const statusAfterBatch = getExportJobStatus(jobId);
      if (statusAfterBatch === 'paused' || statusAfterBatch === 'cancelled') {
        return false;
      }
    }

    pendingByAlbum.delete(currentAlbumId);
    return true;
  };

  for (const row of rows) {
    const currentStatus = getExportJobStatus(jobId);

    if (currentStatus === 'paused' || currentStatus === 'cancelled') {
      return refreshExportJobCounters(jobId, currentStatus);
    }

    const item = toItemRecord(row);

    try {
      const metadata = ensureGooglePhotosItemMetadata(item.id, accountId, item.destinationPath);

      if (metadata.mediaItemId) {
        persistExportItemResult(item.id, 'skipped', null, item.relativePath);
        refreshExportJobCounters(jobId);
        continue;
      }

      markExportItemRunning(item.id, item.relativePath);
      const album = await getOrCreateGooglePhotosAlbum(accountId, metadata.localAlbumTitle);
      const statusAfterAlbum = getExportJobStatus(jobId);
      if (statusAfterAlbum === 'paused' || statusAfterAlbum === 'cancelled') {
        return refreshExportJobCounters(jobId, statusAfterAlbum);
      }

      const upload = isUploadTokenFresh(metadata)
        ? { uploadToken: metadata.uploadToken as string, createdAt: metadata.uploadTokenCreatedAt as string }
        : await uploadGooglePhotosMedia(accountId, item.sourcePath, path.basename(item.sourcePath));

      if (!isUploadTokenFresh(metadata)) {
        updateGooglePhotosItemUploaded(item.id, album.googleAlbumId, upload.uploadToken, upload.createdAt);
      }

      const statusAfterUpload = getExportJobStatus(jobId);
      if (statusAfterUpload === 'paused' || statusAfterUpload === 'cancelled') {
        return refreshExportJobCounters(jobId, statusAfterUpload);
      }

      const queued = pendingByAlbum.get(album.googleAlbumId) ?? [];
      queued.push({ item, uploadToken: upload.uploadToken, uploadCreatedAt: upload.createdAt });
      pendingByAlbum.set(album.googleAlbumId, queued);

      if (queued.length >= batchSize && !(await flushAlbum(album.googleAlbumId))) {
        return refreshExportJobCounters(jobId, getExportJobStatus(jobId) ?? 'paused');
      }
    } catch (error) {
      persistExportItemResult(
        item.id,
        'failed',
        error instanceof Error ? error.message : 'Could not upload file to Google Photos.',
        item.relativePath
      );
      refreshExportJobCounters(jobId);
    }

    await yieldToEventLoop();

    const statusAfterItem = getExportJobStatus(jobId);
    if (statusAfterItem === 'paused' || statusAfterItem === 'cancelled') {
      return refreshExportJobCounters(jobId, statusAfterItem);
    }
  }

  for (const albumId of [...pendingByAlbum.keys()]) {
    if (!(await flushAlbum(albumId))) {
      return refreshExportJobCounters(jobId, getExportJobStatus(jobId) ?? 'paused');
    }
  }

  return refreshExportJobCounters(jobId);
};
