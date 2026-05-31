export type BackendHealthStatus = 'checking' | 'online' | 'offline';

export type BackendHealthSnapshot = {
  status: BackendHealthStatus;
  lastOkAt: number | null;
  lastCheckedAt: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  errorMessage: string | null;
};

export const checkBackendHealth = async (timeoutMs = 2500): Promise<BackendHealthSnapshot> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const checkedAt = Date.now();

  try {
    const response = await fetch('/api/health', {
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`${response.status}: ${response.statusText}`);
    }

    return {
      status: 'online',
      lastOkAt: Date.now(),
      lastCheckedAt: checkedAt,
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      errorMessage: null
    };
  } catch (error) {
    return {
      status: 'offline',
      lastOkAt: null,
      lastCheckedAt: checkedAt,
      consecutiveFailures: 1,
      consecutiveSuccesses: 0,
      errorMessage: error instanceof Error ? error.message : 'Backend health check failed.'
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

export const mergeBackendHealthSnapshot = (
  current: BackendHealthSnapshot,
  probe: BackendHealthSnapshot,
  offlineFailureThreshold = 2
): BackendHealthSnapshot => {
  if (probe.status === 'online') {
    return {
      ...probe,
      status: 'online',
      consecutiveFailures: 0,
      consecutiveSuccesses: current.consecutiveSuccesses + 1,
      errorMessage: null
    };
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  const shouldShowOffline = consecutiveFailures >= offlineFailureThreshold;

  return {
    ...probe,
    status: shouldShowOffline ? 'offline' : current.status,
    lastOkAt: current.lastOkAt,
    consecutiveFailures,
    consecutiveSuccesses: 0,
    errorMessage: shouldShowOffline ? probe.errorMessage : current.errorMessage
  };
};
