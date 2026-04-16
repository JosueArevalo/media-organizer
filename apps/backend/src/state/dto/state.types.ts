export type JobStatus =
  | 'draft'
  | 'scanned'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MediaType = 'image' | 'video' | 'unknown';

export type SourceKind = 'camera' | 'whatsapp' | 'screenshot' | 'unknown';

export type StageName = 'scan' | 'classify' | 'compress' | 'organize';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface JobRecord {
  id: string;
  name: string | null;
  sourceDir: string;
  outputDir: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface MediaItemRecord {
  id: string;
  jobId: string;
  sourcePath: string;
  relativePath: string;
  mediaType: MediaType;
  sourceKindDetected: SourceKind;
  sourceKindOverride: SourceKind | null;
  sizeBytes: number;
  captureTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemDecisionRecord {
  id: string;
  jobId: string;
  itemId: string;
  selectedForCompression: boolean;
  selectedForOutput: boolean;
  targetGroupLabel: string | null;
  userOverridden: boolean;
  updatedAt: string;
}

export interface ItemStageStatusRecord {
  id: string;
  jobId: string;
  itemId: string;
  stage: StageName;
  status: StageStatus;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
}

export interface JobCheckpointRecord {
  id: string;
  jobId: string;
  stage: StageName;
  cursor: string | null;
  payloadJson: string | null;
  updatedAt: string;
}

export interface JobProgressSummary {
  jobId: string;
  stage: StageName;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
}

export const resolveEffectiveSourceKind = (item: Pick<MediaItemRecord, 'sourceKindDetected' | 'sourceKindOverride'>): SourceKind => {
  return item.sourceKindOverride ?? item.sourceKindDetected;
};
