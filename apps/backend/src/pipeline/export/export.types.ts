export type ExportTargetType = 'network-folder' | 'google-photos';

export type ExportJobStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type ExportItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type NetworkFolderTarget = {
  type: 'network-folder';
  destinationPath: string;
};

export type GooglePhotosTarget = {
  type: 'google-photos';
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
};

export type ExportTargetTestRequest = {
  target: ExportTarget;
};

export type ExportTargetTestResult = {
  ok: boolean;
  message: string;
  targetType: ExportTargetType;
};
