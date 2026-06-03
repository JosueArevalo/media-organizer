import path from 'node:path';
import {
  createGooglePhotosMediaItems,
  ensureGooglePhotosItemMetadata,
  getOrCreateGooglePhotosAlbum,
  isUploadTokenFresh,
  redactGooglePhotosUploadToken,
  updateGooglePhotosItemCreated,
  updateGooglePhotosItemUploaded,
  uploadGooglePhotosMedia
} from './googlePhotosApi.service.js';
import {
  getExportJob,
  getExportJobStatus,
  listRunnableExportItems,
  markExportItemRunning,
  markExportJobRunning,
  persistExportItemResult,
  refreshExportJobCounters
} from './exportJob.service.js';
import type { ExportItemRecord } from './export.types.js';
import type { GooglePhotosBatchCreateResult } from './googlePhotos.types.js';

const batchSize = 50;
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

const inferContentType = (filePath: string) => {
  const extension = path.extname(filePath).toLocaleLowerCase();

  const contentTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.mts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.3gp': 'video/3gpp',
    '.3g2': 'video/3gpp2'
  };

  return contentTypes[extension] ?? 'application/octet-stream';
};

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
    parts.push(`Message: ${status.message}.`);
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
  parts.push(`Inferred Content-Type: ${inferContentType(queued.item.sourcePath)}.`);
  parts.push(`Upload token: ${redactGooglePhotosUploadToken(queued.uploadToken)}.`);

  return parts.join(' ');
};

const createUploadedBatch = async (
  accountId: string,
  albumId: string,
  items: Array<{ item: ExportItemRecord; uploadToken: string }>
) => {
  const results = await createGooglePhotosMediaItems(
    accountId,
    albumId,
    items.map(({ item, uploadToken }) => ({
      uploadToken,
      description: item.relativePath
    }))
  );

  for (const queued of items) {
    const result = results.find((candidate) => candidate.uploadToken === queued.uploadToken);

    if (result?.mediaItem?.id) {
      console.info(
        `${GOOGLE_PHOTOS_LOG_PREFIX} Created media item albumId=${albumId} file="${queued.item.relativePath}" mediaItemId=${result.mediaItem.id} uploadToken=${redactGooglePhotosUploadToken(queued.uploadToken)}`
      );
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
  markExportJobRunning(jobId);
  await yieldToEventLoop();
  refreshExportJobCounters(jobId, 'running');

  const rows = listRunnableExportItems(jobId);

  if (rows.length === 0) {
    return refreshExportJobCounters(jobId, 'completed');
  }

  const pendingByAlbum = new Map<string, Array<{ item: ExportItemRecord; uploadToken: string }>>();

  const flushAlbum = async (albumId: string) => {
    const queued = pendingByAlbum.get(albumId) ?? [];

    while (queued.length > 0) {
      const currentStatus = getExportJobStatus(jobId);

      if (currentStatus === 'paused' || currentStatus === 'cancelled') {
        return false;
      }

      await createUploadedBatch(accountId, albumId, queued.splice(0, batchSize));
      refreshExportJobCounters(jobId);
      await yieldToEventLoop();
    }

    pendingByAlbum.delete(albumId);
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
      const upload = isUploadTokenFresh(metadata)
        ? { uploadToken: metadata.uploadToken as string, createdAt: metadata.uploadTokenCreatedAt as string }
        : await uploadGooglePhotosMedia(accountId, item.sourcePath, path.basename(item.sourcePath));

      if (!isUploadTokenFresh(metadata)) {
        updateGooglePhotosItemUploaded(item.id, album.googleAlbumId, upload.uploadToken, upload.createdAt);
      }

      const queued = pendingByAlbum.get(album.googleAlbumId) ?? [];
      queued.push({ item, uploadToken: upload.uploadToken });
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
  }

  for (const albumId of [...pendingByAlbum.keys()]) {
    if (!(await flushAlbum(albumId))) {
      return refreshExportJobCounters(jobId, getExportJobStatus(jobId) ?? 'paused');
    }
  }

  return refreshExportJobCounters(jobId);
};
