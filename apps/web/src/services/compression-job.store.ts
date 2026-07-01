export type CompressionSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export type CompressionSessionSnapshot = {
  backendSessionId: string | null;
  status: CompressionSessionStatus;
  startedAt: number | null;
  completedAt: number | null;
  imageProfileLabel: string | null;
  imageQuality: number | null;
  videoPresetLabel: string | null;
  outputRootLabel: string | null;
  errorMessage: string | null;
  updatedAt: number;
};

export type CompressionSessionStartPayload = {
  backendSessionId: string | null;
  imageProfileLabel: string;
  imageQuality: number;
  videoPresetLabel: string;
  outputRootLabel: string;
};

const STORAGE_KEY = 'media-organizer-compression-session';
const STORAGE_EVENT_NAME = 'media-organizer-compression-session-updated';

const createEmptySnapshot = (): CompressionSessionSnapshot => ({
  backendSessionId: null,
  status: 'idle',
  startedAt: null,
  completedAt: null,
  imageProfileLabel: null,
  imageQuality: null,
  videoPresetLabel: null,
  outputRootLabel: null,
  errorMessage: null,
  updatedAt: 0
});

const readSnapshot = (): CompressionSessionSnapshot => {
  if (typeof window === 'undefined') {
    return createEmptySnapshot();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return createEmptySnapshot();
    }

    const parsed = JSON.parse(raw) as Partial<CompressionSessionSnapshot>;

    return {
      ...createEmptySnapshot(),
      ...parsed,
      status: parsed.status ?? 'idle'
    };
  } catch {
    return createEmptySnapshot();
  }
};

const writeSnapshot = (snapshot: CompressionSessionSnapshot) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME));
  } catch {
    // Ignore storage failures and keep the session state in memory.
  }
};

export const loadCompressionSessionSnapshot = () => readSnapshot();

export const saveCompressionSessionSnapshot = (snapshot: CompressionSessionSnapshot) => {
  writeSnapshot(snapshot);
  return snapshot;
};

export const isCompressionSessionComplete = () => readSnapshot().status === 'completed';

export const startCompressionSession = (payload: CompressionSessionStartPayload) => {
  const snapshot: CompressionSessionSnapshot = {
    backendSessionId: payload.backendSessionId,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    imageProfileLabel: payload.imageProfileLabel,
    imageQuality: payload.imageQuality,
    videoPresetLabel: payload.videoPresetLabel,
    outputRootLabel: payload.outputRootLabel,
    errorMessage: null,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const completeCompressionSession = () => {
  const current = readSnapshot();

  if (current.status === 'completed') {
    return current;
  }

  const snapshot: CompressionSessionSnapshot = {
    ...current,
    status: 'completed',
    completedAt: Date.now(),
    errorMessage: null,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const resetCompressionSession = () => {
  const snapshot = createEmptySnapshot();

  writeSnapshot(snapshot);

  return snapshot;
};

export const failCompressionSession = (errorMessage: string) => {
  const current = readSnapshot();
  const snapshot: CompressionSessionSnapshot = {
    ...current,
    status: 'failed',
    completedAt: Date.now(),
    errorMessage,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const subscribeCompressionSessionChanges = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT_NAME, callback as EventListener);

  return () => window.removeEventListener(STORAGE_EVENT_NAME, callback as EventListener);
};

export const pauseCompressionSession = (errorMessage: string | null = null) => {
  const current = readSnapshot();
  const snapshot: CompressionSessionSnapshot = {
    ...current,
    status: 'paused',
    completedAt: null,
    errorMessage,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};
