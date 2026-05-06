export type CompressionJobStatus = 'idle' | 'running' | 'completed' | 'failed';

export type CompressionJobSnapshot = {
  status: CompressionJobStatus;
  startedAt: number | null;
  completedAt: number | null;
  imageProfileLabel: string | null;
  imageQuality: number | null;
  videoPresetLabel: string | null;
  outputRootLabel: string | null;
  updatedAt: number;
};

export type CompressionJobStartPayload = {
  imageProfileLabel: string;
  imageQuality: number;
  videoPresetLabel: string;
  outputRootLabel: string;
};

const STORAGE_KEY = 'media-organizer-compression-job';
const STORAGE_EVENT_NAME = 'media-organizer-compression-job-updated';

const createEmptySnapshot = (): CompressionJobSnapshot => ({
  status: 'idle',
  startedAt: null,
  completedAt: null,
  imageProfileLabel: null,
  imageQuality: null,
  videoPresetLabel: null,
  outputRootLabel: null,
  updatedAt: 0
});

const readSnapshot = (): CompressionJobSnapshot => {
  if (typeof window === 'undefined') {
    return createEmptySnapshot();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return createEmptySnapshot();
    }

    const parsed = JSON.parse(raw) as Partial<CompressionJobSnapshot>;

    return {
      ...createEmptySnapshot(),
      ...parsed,
      status: parsed.status ?? 'idle'
    };
  } catch {
    return createEmptySnapshot();
  }
};

const writeSnapshot = (snapshot: CompressionJobSnapshot) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME));
  } catch {
    // Ignore storage failures and keep the job state in memory.
  }
};

export const loadCompressionJobSnapshot = () => readSnapshot();

export const isCompressionJobComplete = () => readSnapshot().status === 'completed';

export const startCompressionJob = (payload: CompressionJobStartPayload) => {
  const snapshot: CompressionJobSnapshot = {
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    imageProfileLabel: payload.imageProfileLabel,
    imageQuality: payload.imageQuality,
    videoPresetLabel: payload.videoPresetLabel,
    outputRootLabel: payload.outputRootLabel,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const completeCompressionJob = () => {
  const current = readSnapshot();

  if (current.status === 'completed') {
    return current;
  }

  const snapshot: CompressionJobSnapshot = {
    ...current,
    status: 'completed',
    completedAt: Date.now(),
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const resetCompressionJob = () => {
  const snapshot = createEmptySnapshot();

  writeSnapshot(snapshot);

  return snapshot;
};

export const subscribeCompressionJobChanges = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT_NAME, callback as EventListener);

  return () => window.removeEventListener(STORAGE_EVENT_NAME, callback as EventListener);
};