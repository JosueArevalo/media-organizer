import type {
  ExportItem,
  ExportItemStatus,
  ExportGroupPreview,
  ExportGroupProgress,
  ExportPreview
} from './export.service';

export type ExportRenderStatus = ExportItemStatus | 'paused';

export type ExportTrackedItem = {
  relativePath: string;
  sizeBytes: number;
  status: ExportItemStatus;
  id: string | null;
  jobId: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type ExportItemState = Record<string, ExportTrackedItem>;

const isResolvedStatus = (status: ExportItemStatus) => status === 'completed' || status === 'skipped';

const toTimestamp = (value: string | null) => {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
};

const shouldReplaceTrackedItem = (current: ExportTrackedItem | undefined, incoming: ExportTrackedItem) => {
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
  item: ExportGroupPreview['items'][number],
  groupComplete: boolean
): ExportTrackedItem => ({
  relativePath: item.relativePath,
  sizeBytes: item.sizeBytes,
  status: item.status ?? (groupComplete ? 'completed' : 'pending'),
  id: item.id ?? null,
  jobId: item.jobId ?? null,
  lastError: item.lastError ?? null,
  updatedAt: item.updatedAt ?? null
});

const toProgressTrackedItem = (item: ExportItem): ExportTrackedItem => ({
  relativePath: item.relativePath,
  sizeBytes: item.sizeBytes,
  status: item.status,
  id: item.id,
  jobId: item.jobId,
  lastError: item.lastError,
  updatedAt: item.updatedAt
});

export const createExportItemState = (preview: ExportPreview): ExportItemState => {
  const next: ExportItemState = {};

  for (const group of preview.groups) {
    const groupComplete = group.exportStatus === 'completed';
    for (const item of group.items) {
      if (!item.supported) continue;
      next[item.relativePath] = toPreviewTrackedItem(item, groupComplete);
    }
  }

  return next;
};

export const mergeExportProgressItems = (
  current: ExportItemState,
  items: ExportItem[]
): ExportItemState => {
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

export type ExportDerivedGroupView = Omit<ExportGroupPreview, 'items'> & {
  groupProgress: ExportGroupProgress | undefined;
  items: Array<Omit<ExportTrackedItem, 'status'> & { status: ExportRenderStatus }>;
  totalCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  pendingCount: number;
  derivedStatus: ExportRenderStatus;
  isComplete: boolean;
  progressPercent: number;
  failureSummary: string | null;
};

const getFailureSummary = (items: ExportDerivedGroupView['items']) => {
  if (items.length === 0) return null;
  const failedItems = items.filter((item) => item.status === 'failed' && item.lastError);
  if (failedItems.length !== items.length) return null;
  const uniqueErrors = new Set(failedItems.map((item) => item.lastError));
  return uniqueErrors.size === 1 ? failedItems[0]?.lastError ?? null : null;
};

export const deriveExportGroupView = (input: {
  group: ExportGroupPreview;
  itemState: ExportItemState;
  groupProgress?: ExportGroupProgress;
  isPaused: boolean;
}): ExportDerivedGroupView => {
  const { group, groupProgress, itemState, isPaused } = input;
  const fallbackComplete = group.exportStatus === 'completed';
  const items = group.items
    .filter((item) => item.supported)
    .map((item) => {
      const tracked = itemState[item.relativePath] ?? toPreviewTrackedItem(item, fallbackComplete);
      return {
        ...tracked,
        status: isPaused && tracked.status === 'running' ? 'paused' as const : tracked.status
      };
    });

  if (items.length === 0) {
    const totalCount = groupProgress?.total ?? group.itemCount;
    const completedCount = groupProgress?.completed ?? 0;
    const skippedCount = groupProgress?.skipped ?? 0;
    const failedCount = groupProgress?.failed ?? 0;
    const pendingCount = Math.max(groupProgress?.pending ?? totalCount - completedCount - skippedCount - failedCount, 0);
    const hasActivity = completedCount > 0 || skippedCount > 0 || failedCount > 0 || pendingCount < totalCount;
    const derivedStatus: ExportRenderStatus = failedCount > 0
      ? 'failed'
      : groupProgress?.status === 'running' && hasActivity
      ? (isPaused ? 'paused' : 'running')
      : groupProgress?.status === 'skipped'
      ? 'skipped'
      : fallbackComplete || (totalCount > 0 && completedCount + skippedCount >= totalCount)
      ? 'completed'
      : isPaused && groupProgress
      ? 'paused'
      : 'pending';

    return {
      ...group,
      groupProgress,
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
    groupProgress
    && (groupProgress.completed > 0 || groupProgress.failed > 0 || groupProgress.skipped > 0 || groupProgress.status === 'running')
  );
  const derivedStatus: ExportRenderStatus = failedCount > 0
    ? 'failed'
    : runningCount > 0 || (hasCurrentJobActivity && groupProgress?.status === 'running')
    ? (isPaused ? 'paused' : 'running')
    : completedCount + skippedCount >= totalCount
    ? (skippedCount === totalCount ? 'skipped' : 'completed')
    : isPaused && groupProgress
    ? 'paused'
    : 'pending';

  return {
    ...group,
    groupProgress,
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
