export type ExportTargetType = 'network-folder' | 'google-photos';

export type ExportJobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type ExportItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type NetworkFolderTarget = {
  type: 'network-folder';
  destinationPath: string;
};

export type NetworkCredentials = {
  username?: string;
  password?: string;
  rememberInWindows?: boolean;
};

export type GooglePhotosTarget = {
  type: 'google-photos';
  accountId: string;
  albumTitles?: string[];
};

export type ExportTarget = NetworkFolderTarget | GooglePhotosTarget;

export type ExportJobRequest = {
  name?: string;
  sourceRoot: string;
  target: ExportTarget;
};

export type ExportJobRecord = {
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

export type ExportItemRecord = {
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

export type ExportCheckpointRecord = {
  id: string;
  jobId: string;
  cursor: string | null;
  payloadJson: string | null;
  updatedAt: string;
};

export type ExportJobSnapshot = {
  job: ExportJobRecord;
  checkpoint: ExportCheckpointRecord | null;
  recentItems: ExportItemRecord[];
};

export type ExportProgressData = {
  jobId: string;
  status: ExportJobStatus;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  recentItems: ExportItemRecord[];
  albumProgress?: GooglePhotosAlbumProgress[];
};

export type ExportTargetTestRequest = {
  target: ExportTarget;
  credentials?: NetworkCredentials;
};

export type ExportTargetTestResult = {
  ok: boolean;
  message: string;
  targetType: ExportTargetType;
  details?: string | null;
  requiresAuthentication?: boolean;
};

export type GooglePhotosAccountRecord = {
  id: string;
  email: string;
  displayName: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string;
};

export type GooglePhotosAuthStartResult = {
  authUrl: string;
  state: string;
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
  account: GooglePhotosAccountRecord;
  albums: GooglePhotosAlbumPreview[];
  supportedItems: number;
  unsupportedItems: number;
};

export type NetworkDestinationRecord = {
  id: string;
  name: string;
  rootPath: string;
  username: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type NetworkDestinationRequest = {
  name?: string;
  rootPath: string;
  username?: string;
};

export type NetworkAuthRequest = {
  path: string;
  credentials: NetworkCredentials;
};

export type NetworkBrowseRequest = {
  path: string;
  rootPath?: string;
  credentials?: NetworkCredentials;
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

export type NetworkCreateFolderRequest = {
  parentPath: string;
  folderName: string;
  rootPath?: string;
  credentials?: NetworkCredentials;
};
