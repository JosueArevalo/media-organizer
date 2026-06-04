import type { ExportJobStatus, ExportTargetType } from './export.service';

export type ExportJobSnapshot = {
  backendJobId: string | null;
  status: ExportJobStatus | 'idle';
  sourceRoot: string | null;
  groupingSessionId: string | null;
  destinationPath: string | null;
  googlePhotosAccountId: string | null;
  targetType: ExportTargetType | null;
  startedAt: number | null;
  completedAt: number | null;
  errorMessage: string | null;
  updatedAt: number;
};

export type ExportJobSnapshotContext = {
  groupingSessionId?: string | null;
  sourceRoot?: string | null;
};

type ExportJobSnapshots = Partial<Record<ExportTargetType, ExportJobSnapshot>>;

const LEGACY_STORAGE_KEY = 'media-organizer-export-job';
const STORAGE_KEY = 'media-organizer-export-jobs';
const STORAGE_EVENT_NAME = 'media-organizer-export-job-updated';

const createEmptySnapshot = (targetType: ExportTargetType | null = null): ExportJobSnapshot => ({
  backendJobId: null,
  status: 'idle',
  sourceRoot: null,
  groupingSessionId: null,
  destinationPath: null,
  googlePhotosAccountId: null,
  targetType,
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  updatedAt: 0
});

const normalizeSnapshot = (snapshot: Partial<ExportJobSnapshot>, targetType: ExportTargetType): ExportJobSnapshot => ({
  ...createEmptySnapshot(targetType),
  ...snapshot,
  targetType
});

const readSnapshots = (): ExportJobSnapshots => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw) as ExportJobSnapshots;
      return Object.fromEntries(
        (['network-folder', 'google-photos'] as ExportTargetType[])
          .filter((targetType) => parsed[targetType])
          .map((targetType) => [targetType, normalizeSnapshot(parsed[targetType] as Partial<ExportJobSnapshot>, targetType)])
      );
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) {
      return {};
    }

    const legacy = JSON.parse(legacyRaw) as Partial<ExportJobSnapshot>;
    if (legacy.targetType !== 'network-folder' && legacy.targetType !== 'google-photos') {
      return {};
    }

    const migrated = { [legacy.targetType]: normalizeSnapshot(legacy, legacy.targetType) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return migrated;
  } catch {
    return {};
  }
};

const writeSnapshots = (snapshots: ExportJobSnapshots) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME));
  } catch {
    // Keep the page usable when storage is unavailable.
  }
};

const matchesContext = (snapshot: ExportJobSnapshot, context?: ExportJobSnapshotContext) => {
  if (!context) {
    return true;
  }

  if (context.sourceRoot && snapshot.sourceRoot !== context.sourceRoot) {
    return false;
  }

  if (context.groupingSessionId && snapshot.groupingSessionId && snapshot.groupingSessionId !== context.groupingSessionId) {
    return false;
  }

  return true;
};

export const loadExportJobSnapshot = (targetType?: ExportTargetType, context?: ExportJobSnapshotContext) => {
  const snapshots = readSnapshots();

  if (targetType) {
    const snapshot = snapshots[targetType] ?? createEmptySnapshot(targetType);
    return matchesContext(snapshot, context) ? snapshot : createEmptySnapshot(targetType);
  }

  const candidates = Object.values(snapshots).filter((snapshot) => snapshot && matchesContext(snapshot, context)) as ExportJobSnapshot[];
  return candidates.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? createEmptySnapshot();
};

export const saveExportJobSnapshot = (snapshot: ExportJobSnapshot) => {
  if (!snapshot.targetType) {
    return snapshot;
  }

  writeSnapshots({
    ...readSnapshots(),
    [snapshot.targetType]: normalizeSnapshot(snapshot, snapshot.targetType)
  });
  return snapshot;
};

export const resetExportJobSnapshot = (targetType?: ExportTargetType) => {
  if (!targetType) {
    writeSnapshots({});
    return createEmptySnapshot();
  }

  const snapshots = readSnapshots();
  delete snapshots[targetType];
  writeSnapshots(snapshots);
  return createEmptySnapshot(targetType);
};

export const subscribeExportJobChanges = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT_NAME, callback as EventListener);

  return () => window.removeEventListener(STORAGE_EVENT_NAME, callback as EventListener);
};
