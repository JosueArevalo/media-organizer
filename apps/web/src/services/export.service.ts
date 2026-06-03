export type ExportTargetType = 'network-folder' | 'google-photos';

export type ExportJobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type ExportItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type NetworkFolderTarget = {
  type: 'network-folder';
  destinationPath: string;
};

export type GooglePhotosTarget = {
  type: 'google-photos';
  accountId: string;
  albumTitles?: string[];
};

export type ExportTarget = NetworkFolderTarget | GooglePhotosTarget;

export type NetworkCredentials = {
  username?: string;
  password?: string;
  rememberInWindows?: boolean;
};

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
  albumProgress?: GooglePhotosAlbumProgress[];
};

export type ExportTargetTestResult = {
  ok: boolean;
  message: string;
  targetType: ExportTargetType;
  details?: string | null;
  requiresAuthentication?: boolean;
};

export type GooglePhotosAccount = {
  id: string;
  email: string;
  displayName: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string;
};

export type GooglePhotosOAuthConfigSource = 'local-db' | 'env' | 'none';

export type GooglePhotosOAuthConfigStatus = {
  configured: boolean;
  source: GooglePhotosOAuthConfigSource;
  redirectUri: string;
  requiredScopes: string[];
  hasClientSecret: boolean;
};

export type GooglePhotosOAuthConfigRequest = {
  clientId: string;
  clientSecret?: string;
};

export type GooglePhotosAlbumPreview = {
  folderName: string;
  albumTitle: string;
  status: 'existing' | 'new';
  itemCount: number;
  items: GooglePhotosAlbumPreviewItem[];
};

export type GooglePhotosAlbumPreviewItem = {
  relativePath: string;
  sizeBytes: number;
  supported: boolean;
};

export type GooglePhotosAlbumProgress = {
  albumTitle: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
};

export type GooglePhotosExportPreview = {
  account: GooglePhotosAccount;
  albums: GooglePhotosAlbumPreview[];
  supportedItems: number;
  unsupportedItems: number;
};

export type NetworkDestination = {
  id: string;
  name: string;
  rootPath: string;
  username: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type NetworkBrowseEntry = {
  name: string;
  path: string;
  kind: 'share' | 'directory';
};

export type NetworkBrowseResult = {
  path: string;
  parentPath: string | null;
  entries: NetworkBrowseEntry[];
  canCreateFolder: boolean;
};

export const isValidUncPath = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed || trimmed.includes('/')) {
    return false;
  }

  const segments = trimmed.replace(/\\+$/, '').split('\\').filter(Boolean);

  return trimmed.startsWith('\\\\') && segments.length >= 1 && segments.every((segment) => segment !== '.' && segment !== '..');
};

const readErrorBody = async (response: Response) => {
  const body = await response.text();

  if (!body) {
    return response.statusText;
  }

  try {
    const parsed = JSON.parse(body) as { message?: string; details?: string };
    return [parsed.message, parsed.details].filter(Boolean).join(' ');
  } catch {
    return body;
  }
};

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(`${response.status}: ${await readErrorBody(response)}`);
  }

  return (await response.json()) as T;
};

export const testExportTargetRequest = (target: ExportTarget, credentials?: NetworkCredentials) =>
  requestJson<ExportTargetTestResult>('/api/export/targets/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, credentials })
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

export const listGooglePhotosAccountsRequest = () =>
  requestJson<{ accounts: GooglePhotosAccount[] }>('/api/export/google-photos/accounts');

export const getGooglePhotosOAuthConfigRequest = () =>
  requestJson<GooglePhotosOAuthConfigStatus>('/api/export/google-photos/config');

export const saveGooglePhotosOAuthConfigRequest = (payload: GooglePhotosOAuthConfigRequest) =>
  requestJson<GooglePhotosOAuthConfigStatus>('/api/export/google-photos/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const deleteGooglePhotosOAuthConfigRequest = () =>
  requestJson<GooglePhotosOAuthConfigStatus>('/api/export/google-photos/config', { method: 'DELETE' });

export const startGooglePhotosOAuthRequest = () =>
  requestJson<{ authUrl: string; state: string }>('/api/export/google-photos/oauth/start', { method: 'POST' });

export const deleteGooglePhotosAccountRequest = async (accountId: string) => {
  const response = await fetch(`/api/export/google-photos/accounts/${accountId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(`${response.status}: ${await readErrorBody(response)}`);
  }
};

export const previewGooglePhotosExportRequest = (payload: { accountId: string; sourceRoot: string }) =>
  requestJson<GooglePhotosExportPreview>('/api/export/google-photos/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const listNetworkDestinationsRequest = () =>
  requestJson<{ destinations: NetworkDestination[] }>('/api/export/network-destinations');

export const saveNetworkDestinationRequest = (payload: { name?: string; rootPath: string; username?: string }) =>
  requestJson<NetworkDestination>('/api/export/network-destinations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const deleteNetworkDestinationRequest = async (destinationId: string) => {
  const response = await fetch(`/api/export/network-destinations/${destinationId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(`${response.status}: ${await readErrorBody(response)}`);
  }
};

export const authenticateNetworkPathRequest = (payload: { path: string; credentials: NetworkCredentials }) =>
  requestJson<{ ok: boolean; message: string }>('/api/export/network/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const browseNetworkPathRequest = (payload: { path: string; rootPath?: string; credentials?: NetworkCredentials }) =>
  requestJson<NetworkBrowseResult>('/api/export/network/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

export const createNetworkFolderRequest = (payload: {
  parentPath: string;
  folderName: string;
  rootPath?: string;
  credentials?: NetworkCredentials;
}) =>
  requestJson<{ path: string; name: string }>('/api/export/network/create-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
