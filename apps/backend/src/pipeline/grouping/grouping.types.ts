import type { SessionCheckpointRecord, SessionRecord } from '../../state/dto/state.types.js';

export type GroupingSessionRequest = {
  name?: string;
  sourceDir: string;
  outputDir: string;
  compressionSessionId?: string;
  preservedDirectories?: string[];
  reorganizedDirectories?: string[];
  rules?: GroupingRuleId[];
  strategy?: 'date' | 'source-kind';
  autoRename?: boolean;
};

export type GroupingRuleId = 'date-event-multiple' | 'single-date-year-unique';

export type GroupingSessionManifest = {
  sessionId: string;
  sourceDir: string;
  outputDir: string;
  outputRoot: string;
  compressionSessionId: string | null;
  preservedDirectories: string[];
  reorganizedDirectories: string[];
  rules: GroupingRuleId[];
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
