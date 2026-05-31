export type BackendHealthStatus = 'checking' | 'online' | 'offline';

export type BackendHealthSnapshot = {
  status: BackendHealthStatus;
  lastOkAt: number | null;
  lastCheckedAt: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureKind: 'timeout' | 'network' | 'http' | null;
  errorMessage: string | null;
};

export const DEFAULT_BACKEND_HEALTH_TIMEOUT_MS = 1500;
export const DEFAULT_BACKEND_HEALTH_OFFLINE_FAILURE_THRESHOLD = 2;
export const DEFAULT_BACKEND_HEALTH_TIMEOUT_FAILURE_THRESHOLD = 4;

const getFailureKind = (error: unknown): NonNullable<BackendHealthSnapshot['failureKind']> => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout';
  }

  if (error instanceof Error && error.message.startsWith('HTTP ')) {
    return 'http';
  }

  return 'network';
};

export const checkBackendHealth = async (timeoutMs = DEFAULT_BACKEND_HEALTH_TIMEOUT_MS): Promise<BackendHealthSnapshot> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const checkedAt = Date.now();

  try {
    const response = await fetch('/api/health', {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return {
      status: 'online',
      lastOkAt: Date.now(),
      lastCheckedAt: checkedAt,
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      failureKind: null,
      errorMessage: null
    };
  } catch (error) {
    return {
      status: 'offline',
      lastOkAt: null,
      lastCheckedAt: checkedAt,
      consecutiveFailures: 1,
      consecutiveSuccesses: 0,
      failureKind: getFailureKind(error),
      errorMessage: error instanceof Error ? error.message : 'Backend health check failed.'
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

export const mergeBackendHealthSnapshot = (
  current: BackendHealthSnapshot,
  probe: BackendHealthSnapshot,
  offlineFailureThreshold = DEFAULT_BACKEND_HEALTH_OFFLINE_FAILURE_THRESHOLD,
  timeoutFailureThreshold = DEFAULT_BACKEND_HEALTH_TIMEOUT_FAILURE_THRESHOLD
): BackendHealthSnapshot => {
  if (probe.status === 'online') {
    return {
      ...probe,
      status: 'online',
      consecutiveFailures: 0,
      consecutiveSuccesses: current.consecutiveSuccesses + 1,
      failureKind: null,
      errorMessage: null
    };
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  const isTimeoutOnly = probe.failureKind === 'timeout';
  const requiredFailures = isTimeoutOnly ? timeoutFailureThreshold : offlineFailureThreshold;
  const shouldShowOffline = consecutiveFailures >= requiredFailures;

  return {
    ...probe,
    status: shouldShowOffline ? 'offline' : current.status,
    lastOkAt: current.lastOkAt,
    consecutiveFailures,
    consecutiveSuccesses: 0,
    errorMessage: shouldShowOffline ? probe.errorMessage : current.errorMessage
  };
};
