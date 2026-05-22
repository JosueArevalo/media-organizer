export type ExportTargetType = 'network-folder' | 'google-photos';

export type ExportJobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type ExportItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type NetworkFolderTarget = {
  type: 'network-folder';
  destinationPath: string;
};

export type ExportTarget = NetworkFolderTarget | { type: 'google-photos' };

export type ExportJobSnapshot = {
  job: {
    id: string;
    name: string | null;
    sourceRoot: string;
    targetType: ExportTargetType;
    targetPath: string | null;
    status: ExportJobStatus;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    skippedItems: number;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    lastOpenedAt: string | null;
  };
  checkpoint: {
    id: string;
    jobId: string;
    cursor: string | null;
    payloadJson: string | null;
    updatedAt: string;
  } | null;
  recentItems: ExportItem[];
};

export type ExportItem = {
  id: string;
  jobId: string;
  sourcePath: string;
  relativePath: string;
  destinationPath: string;
  sizeBytes: number;
  status: ExportItemStatus;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
};

export type ExportProgress = {
  jobId: string;
  status: ExportJobStatus;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  recentItems: ExportItem[];
};

export type ExportTargetTestResult = {
  ok: boolean;
  message: string;
  targetType: ExportTargetType;
};

const readErrorBody = async (response: Response) => {
  const body = await response.text();
  return body || response.statusText;
};

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`${response.status}: ${await readErrorBody(response)}`);
  }

  return (await response.json()) as T;
};

export const testExportTargetRequest = (target: ExportTarget) =>
  requestJson<ExportTargetTestResult>('/api/export/targets/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target })
  });

export const createExportJobRequest = (payload: { name?: string; sourceRoot: string; target: ExportTarget }) =>
  requestJson<ExportJobSnapshot>('/api/export/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const getExportJobRequest = (jobId: string) =>
  requestJson<ExportJobSnapshot>(`/api/export/jobs/${jobId}`);

export const getExportProgressRequest = (jobId: string) =>
  requestJson<ExportProgress>(`/api/export/jobs/${jobId}/progress`);

export const startExportJobRequest = (jobId: string) =>
  requestJson<ExportJobSnapshot>(`/api/export/jobs/${jobId}/start`, { method: 'POST' });

export const pauseExportJobRequest = (jobId: string) =>
  requestJson<ExportJobSnapshot>(`/api/export/jobs/${jobId}/pause`, { method: 'POST' });

export const retryFailedExportItemsRequest = (jobId: string) =>
  requestJson<ExportJobSnapshot>(`/api/export/jobs/${jobId}/retry-failed`, { method: 'POST' });
