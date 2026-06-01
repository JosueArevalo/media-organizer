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
export const BACKEND_HEALTH_PATH = '/api/health';
export const BACKEND_HEALTH_OFFLINE_REPORT_PATH = '/api/health/offline-report';
export const DEV_BACKEND_BASE_URL = 'http://localhost:4000';

type BackendApiEnv = {
  DEV?: boolean;
  VITE_BACKEND_URL?: string;
};

const getFailureKind = (error: unknown): NonNullable<BackendHealthSnapshot['failureKind']> => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout';
  }

  if (error instanceof Error && error.message.startsWith('HTTP ')) {
    return 'http';
  }

  return 'network';
};

export const resolveBackendApiUrl = (path: string, env: BackendApiEnv = import.meta.env ?? {}) => {
  const configuredBackendUrl = env.VITE_BACKEND_URL?.trim();

  if (configuredBackendUrl) {
    return `${configuredBackendUrl.replace(/\/+$/, '')}${path}`;
  }

  if (env.DEV) {
    return `${DEV_BACKEND_BASE_URL}${path}`;
  }

  return path;
};

const getBackendHealthUrl = () => resolveBackendApiUrl(BACKEND_HEALTH_PATH);
const getBackendHealthOfflineReportUrl = () => resolveBackendApiUrl(BACKEND_HEALTH_OFFLINE_REPORT_PATH);

export const checkBackendHealth = async (timeoutMs = DEFAULT_BACKEND_HEALTH_TIMEOUT_MS): Promise<BackendHealthSnapshot> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const checkedAt = Date.now();

  try {
    const response = await fetch(getBackendHealthUrl(), {
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

export const reportBackendHealthOffline = async (previous: BackendHealthSnapshot, next: BackendHealthSnapshot) => {
  try {
    await fetch(getBackendHealthOfflineReportUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        previousStatus: previous.status,
        status: next.status,
        failureKind: next.failureKind,
        errorMessage: next.errorMessage,
        consecutiveFailures: next.consecutiveFailures,
        consecutiveSuccesses: next.consecutiveSuccesses,
        lastCheckedAt: next.lastCheckedAt,
        lastOkAt: next.lastOkAt,
        msSinceLastOk: next.lastOkAt === null ? null : Date.now() - next.lastOkAt,
        timeoutMs: DEFAULT_BACKEND_HEALTH_TIMEOUT_MS,
        healthUrl: getBackendHealthUrl()
      })
    });
  } catch {
    // The Vite proxy logs failed diagnostic reports in the terminal during development.
  }
};
