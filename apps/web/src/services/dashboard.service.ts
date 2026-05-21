export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type DashboardExecution = {
  id: string;
  sessionId: string;
  groupingSessionId: string | null;
  name: string | null;
  sourceDir: string;
  outputDir: string;
  outputRoot: string | null;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
  totalItems: number;
  imageItems: number;
  videoItems: number;
  completedItems: number;
  failedItems: number;
  imageProfileLabel: string | null;
  videoPresetLabel: string | null;
  errorSummary: Array<{ source: string; error: string | null }>;
  groupingStatus: ExecutionStatus | null;
  groupingTotalItems: number;
  groupingCompletedItems: number;
  groupingFailedItems: number;
};

export type DashboardSummary = {
  currentExecution: DashboardExecution | null;
  lastExecution: DashboardExecution | null;
  totals: {
    executions: number;
    completedExecutions: number;
    failedExecutions: number;
    filesProcessed: number;
    failedItems: number;
  };
  alerts: Array<{
    id: string;
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
};

export type BackendHealth = {
  status: string;
  service: string;
  time: string;
  dbPath: string;
  appliedMigrations: string[];
};

const readErrorBody = async (response: Response) => {
  const body = await response.text();
  return body || response.statusText;
};

const requestJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${response.status}: ${await readErrorBody(response)}`);
  }

  return (await response.json()) as T;
};

export const getDashboardSummary = async (): Promise<DashboardSummary> => requestJson<DashboardSummary>('/api/dashboard/summary');

export const getDashboardExecutions = async (): Promise<DashboardExecution[]> => {
  const response = await requestJson<{ executions: DashboardExecution[] }>('/api/dashboard/executions');
  return response.executions;
};

export const deleteDashboardExecution = async (executionId: string): Promise<void> => {
  const response = await fetch(`/api/dashboard/executions/${executionId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(`${response.status}: ${await readErrorBody(response)}`);
  }
};

export const getBackendHealth = async (): Promise<BackendHealth> => requestJson<BackendHealth>('/api/health');
