export type GroupingSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export type GroupingSessionSnapshot = {
  backendSessionId: string | null;
  status: GroupingSessionStatus;
  startedAt: number | null;
  completedAt: number | null;
  outputRootLabel: string | null;
  errorMessage: string | null;
  updatedAt: number;
};

export type GroupingSessionStartPayload = {
  backendSessionId: string | null;
  outputRootLabel: string;
};

const STORAGE_KEY = 'media-organizer-grouping-session';
const STORAGE_EVENT_NAME = 'media-organizer-grouping-session-updated';

const createEmptySnapshot = (): GroupingSessionSnapshot => ({
  backendSessionId: null,
  status: 'idle',
  startedAt: null,
  completedAt: null,
  outputRootLabel: null,
  errorMessage: null,
  updatedAt: 0
});

const readSnapshot = (): GroupingSessionSnapshot => {
  if (typeof window === 'undefined') {
    return createEmptySnapshot();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return createEmptySnapshot();
    }

    const parsed = JSON.parse(raw) as Partial<GroupingSessionSnapshot>;

    return {
      ...createEmptySnapshot(),
      ...parsed,
      status: parsed.status ?? 'idle'
    };
  } catch {
    return createEmptySnapshot();
  }
};

const writeSnapshot = (snapshot: GroupingSessionSnapshot) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME));
  } catch {
    // Keep the in-page state usable when localStorage is unavailable.
  }
};

export const loadGroupingSessionSnapshot = () => readSnapshot();

export const startGroupingSession = (payload: GroupingSessionStartPayload) => {
  const snapshot: GroupingSessionSnapshot = {
    backendSessionId: payload.backendSessionId,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    outputRootLabel: payload.outputRootLabel,
    errorMessage: null,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const pauseGroupingSession = () => {
  const current = readSnapshot();
  const snapshot: GroupingSessionSnapshot = {
    ...current,
    status: 'paused',
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const resumeGroupingSession = () => {
  const current = readSnapshot();
  const snapshot: GroupingSessionSnapshot = {
    ...current,
    status: 'running',
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const completeGroupingSession = () => {
  const current = readSnapshot();
  const snapshot: GroupingSessionSnapshot = {
    ...current,
    status: 'completed',
    completedAt: Date.now(),
    errorMessage: null,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const failGroupingSession = (errorMessage: string) => {
  const current = readSnapshot();
  const snapshot: GroupingSessionSnapshot = {
    ...current,
    status: 'failed',
    completedAt: Date.now(),
    errorMessage,
    updatedAt: Date.now()
  };

  writeSnapshot(snapshot);

  return snapshot;
};

export const resetGroupingSession = () => {
  const snapshot = createEmptySnapshot();

  writeSnapshot(snapshot);

  return snapshot;
};

export const subscribeGroupingSessionChanges = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT_NAME, callback as EventListener);

  return () => window.removeEventListener(STORAGE_EVENT_NAME, callback as EventListener);
};
