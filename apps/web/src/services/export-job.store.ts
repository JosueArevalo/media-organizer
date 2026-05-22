import type { ExportJobStatus } from './export.service';

export type ExportJobSnapshot = {
  backendJobId: string | null;
  status: ExportJobStatus | 'idle';
  sourceRoot: string | null;
  destinationPath: string | null;
  startedAt: number | null;
  completedAt: number | null;
  errorMessage: string | null;
  updatedAt: number;
};

const STORAGE_KEY = 'media-organizer-export-job';
const STORAGE_EVENT_NAME = 'media-organizer-export-job-updated';

const createEmptySnapshot = (): ExportJobSnapshot => ({
  backendJobId: null,
  status: 'idle',
  sourceRoot: null,
  destinationPath: null,
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  updatedAt: 0
});

const readSnapshot = (): ExportJobSnapshot => {
  if (typeof window === 'undefined') {
    return createEmptySnapshot();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return createEmptySnapshot();
    }

    return {
      ...createEmptySnapshot(),
      ...(JSON.parse(raw) as Partial<ExportJobSnapshot>)
    };
  } catch {
    return createEmptySnapshot();
  }
};

const writeSnapshot = (snapshot: ExportJobSnapshot) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME));
  } catch {
    // Keep the page usable when storage is unavailable.
  }
};

export const loadExportJobSnapshot = () => readSnapshot();

export const saveExportJobSnapshot = (snapshot: ExportJobSnapshot) => {
  writeSnapshot(snapshot);
  return snapshot;
};

export const resetExportJobSnapshot = () => {
  const snapshot = createEmptySnapshot();
  writeSnapshot(snapshot);
  return snapshot;
};

export const subscribeExportJobChanges = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT_NAME, callback as EventListener);

  return () => window.removeEventListener(STORAGE_EVENT_NAME, callback as EventListener);
};
