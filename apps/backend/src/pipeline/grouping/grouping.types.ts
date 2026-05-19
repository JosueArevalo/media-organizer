import type { SessionCheckpointRecord, SessionRecord } from '../../state/dto/state.types.js';

export type GroupingSessionRequest = {
  name?: string;
  sourceDir: string;
  outputDir: string;
  compressionSessionId?: string;
  strategy?: 'date' | 'source-kind';
  autoRename?: boolean;
};

export type GroupingSessionManifest = {
  sessionId: string;
  sourceDir: string;
  outputDir: string;
  outputRoot: string;
  compressionSessionId: string | null;
  strategy: 'date' | 'source-kind';
  autoRename: boolean;
  createdAt: string;
};

export type GroupingSessionLaunchResult = {
  session: SessionRecord;
  checkpoint: SessionCheckpointRecord;
  manifest: GroupingSessionManifest;
  outputRoot: string;
  manifestPath: string;
};

export type GroupingProgressData = {
  sessionId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  groups: Array<{
    label: string;
    total: number;
    completed: number;
    failed: number;
  }>;
  processedItems: Array<{
    id: string;
    sourcePath: string;
    targetGroupLabel: string | null;
    status: 'completed' | 'failed' | 'skipped';
  }>;
};
