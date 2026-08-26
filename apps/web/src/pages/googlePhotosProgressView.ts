import type {
  ExportItem,
  ExportItemStatus,
  GooglePhotosAlbumPreview,
  GooglePhotosAlbumProgress,
  GooglePhotosExportPreview
} from '../services/export.service';

export type GooglePhotosRenderStatus = ExportItemStatus | 'paused';

export type GooglePhotosTrackedItem = {
  relativePath: string;
  sizeBytes: number;
  status: ExportItemStatus;
  id: string | null;
  jobId: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type GooglePhotosItemState = Record<string, GooglePhotosTrackedItem>;

const isResolvedStatus = (status: ExportItemStatus) => status === 'completed' || status === 'skipped';

const toTimestamp = (value: string | null) => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const shouldReplaceTrackedItem = (current: GooglePhotosTrackedItem | undefined, incoming: GooglePhotosTrackedItem) => {
  if (!current) return true;

  if (isResolvedStatus(current.status) && !isResolvedStatus(incoming.status)) {
    return false;
  }

  const sameItem = Boolean(current.id && incoming.id && current.id === incoming.id);
  if (sameItem) {
    return toTimestamp(incoming.updatedAt) >= toTimestamp(current.updatedAt);
  }

  if (isResolvedStatus(incoming.status)) {
    return true;
  }

  return toTimestamp(incoming.updatedAt) >= toTimestamp(current.updatedAt);
};

const toPreviewTrackedItem = (
  item: GooglePhotosAlbumPreview['items'][number],
  albumComplete: boolean
): GooglePhotosTrackedItem => ({
  relativePath: item.relativePath,
  sizeBytes: item.sizeBytes,
  status: item.status ?? (albumComplete ? 'completed' : 'pending'),
  id: item.id ?? null,
  jobId: item.jobId ?? null,
  lastError: item.lastError ?? null,
  updatedAt: null
});

const toProgressTrackedItem = (item: ExportItem): GooglePhotosTrackedItem => ({
  relativePath: item.relativePath,
  sizeBytes: item.sizeBytes,
  status: item.status,
  id: item.id,
  jobId: item.jobId,
  lastError: item.lastError,
  updatedAt: item.updatedAt
});

export const createGooglePhotosItemState = (preview: GooglePhotosExportPreview): GooglePhotosItemState => {
  const next: GooglePhotosItemState = {};

  for (const album of preview.albums) {
    const albumComplete = album.uploadStatus === 'completed';
    for (const item of album.items) {
      if (!item.supported) continue;
      next[item.relativePath] = toPreviewTrackedItem(item, albumComplete);
    }
  }

  return next;
};

export const mergeGooglePhotosProgressItems = (
  current: GooglePhotosItemState,
  items: ExportItem[]
): GooglePhotosItemState => {
  if (items.length === 0) return current;

  let changed = false;
  const next = { ...current };

  for (const item of items) {
    const incoming = toProgressTrackedItem(item);
    if (!shouldReplaceTrackedItem(next[item.relativePath], incoming)) continue;
    next[item.relativePath] = incoming;
    changed = true;
  }

  return changed ? next : current;
};

export type GooglePhotosDerivedAlbumView = Omit<GooglePhotosAlbumPreview, 'items'> & {
  albumType: GooglePhotosAlbumPreview['status'];
  albumProgress: GooglePhotosAlbumProgress | undefined;
  items: Array<Omit<GooglePhotosTrackedItem, 'status'> & { status: GooglePhotosRenderStatus }>;
  totalCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  pendingCount: number;
  derivedStatus: GooglePhotosRenderStatus;
  isComplete: boolean;
  progressPercent: number;
  failureSummary: string | null;
};

const getFailureSummary = (items: GooglePhotosDerivedAlbumView['items']) => {
  if (items.length === 0) return null;
  const failedItems = items.filter((item) => item.status === 'failed' && item.lastError);
  if (failedItems.length !== items.length) return null;
  const uniqueErrors = new Set(failedItems.map((item) => item.lastError));
  return uniqueErrors.size === 1 ? failedItems[0]?.lastError ?? null : null;
};

export const deriveGooglePhotosAlbumView = (input: {
  album: GooglePhotosAlbumPreview;
  itemState: GooglePhotosItemState;
  albumProgress?: GooglePhotosAlbumProgress;
  isPaused: boolean;
}): GooglePhotosDerivedAlbumView => {
  const { album, albumProgress, itemState, isPaused } = input;
  const fallbackComplete = album.uploadStatus === 'completed';
  const items = album.items
    .filter((item) => item.supported)
    .map((item) => {
      const tracked = itemState[item.relativePath] ?? toPreviewTrackedItem(item, fallbackComplete);
      return {
        ...tracked,
        status: isPaused && tracked.status === 'running' ? 'paused' as const : tracked.status
      };
    });

  if (items.length === 0) {
    const totalCount = albumProgress?.total ?? album.itemCount;
    const completedCount = albumProgress?.completed ?? 0;
    const skippedCount = albumProgress?.skipped ?? 0;
    const failedCount = albumProgress?.failed ?? 0;
    const pendingCount = Math.max(albumProgress?.pending ?? totalCount - completedCount - skippedCount - failedCount, 0);
    const hasActivity = completedCount > 0 || skippedCount > 0 || failedCount > 0 || pendingCount < totalCount;
    const derivedStatus: GooglePhotosRenderStatus = failedCount > 0
      ? 'failed'
      : albumProgress?.status === 'running' && hasActivity
      ? (isPaused ? 'paused' : 'running')
      : albumProgress?.status === 'skipped'
      ? 'skipped'
      : fallbackComplete || (totalCount > 0 && completedCount + skippedCount >= totalCount)
      ? 'completed'
      : isPaused && albumProgress
      ? 'paused'
      : 'pending';

    return {
      ...album,
      albumType: album.status,
      albumProgress,
      items,
      totalCount,
      completedCount,
      skippedCount,
      failedCount,
      pendingCount,
      derivedStatus,
      isComplete: derivedStatus === 'completed' || derivedStatus === 'skipped',
      progressPercent: totalCount > 0 ? Math.round(((completedCount + skippedCount) / totalCount) * 100) : 0,
      failureSummary: null
    };
  }

  const totalCount = items.length;
  const completedCount = items.filter((item) => item.status === 'completed').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const runningCount = items.filter((item) => item.status === 'running' || item.status === 'paused').length;
  const pendingCount = Math.max(totalCount - completedCount - skippedCount - failedCount - runningCount, 0);
  const hasCurrentJobActivity = Boolean(
    albumProgress
    && (albumProgress.completed > 0 || albumProgress.failed > 0 || albumProgress.skipped > 0 || albumProgress.status === 'running')
  );
  const derivedStatus: GooglePhotosRenderStatus = failedCount > 0
    ? 'failed'
    : runningCount > 0 || (hasCurrentJobActivity && albumProgress?.status === 'running')
    ? (isPaused ? 'paused' : 'running')
    : completedCount + skippedCount >= totalCount
    ? (skippedCount === totalCount ? 'skipped' : 'completed')
    : isPaused && albumProgress
    ? 'paused'
    : 'pending';

  return {
    ...album,
    albumType: album.status,
    albumProgress,
    items,
    totalCount,
    completedCount,
    skippedCount,
    failedCount,
    pendingCount,
    derivedStatus,
    isComplete: derivedStatus === 'completed' || derivedStatus === 'skipped',
    progressPercent: totalCount > 0 ? Math.round(((completedCount + skippedCount) / totalCount) * 100) : 0,
    failureSummary: getFailureSummary(items)
  };
};
