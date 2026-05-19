export type GroupingSessionRequest = {
  name?: string;
  sourceDir: string;
  outputDir: string;
  compressionSessionId?: string | null;
  strategy?: 'date' | 'source-kind';
  autoRename?: boolean;
};

export type GroupingSessionApiResponse = {
  session: {
    id: string;
    status: 'draft' | 'scanned' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    sourceDir: string;
    outputDir: string;
  };
  checkpoint: {
    stage: 'scan' | 'classify' | 'compress' | 'group' | 'organize';
    payloadJson: string | null;
  } | null;
  manifest?: {
    outputRoot: string;
  };
};

export type GroupingProgressApiResponse = {
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

const readErrorBody = async (response: Response) => {
  const body = await response.text();
  return body || response.statusText;
};

export const startGroupingSessionRequest = async (payload: GroupingSessionRequest): Promise<GroupingSessionApiResponse> => {
  const response = await fetch('/api/grouping/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Could not start grouping session (${response.status}): ${await readErrorBody(response)}`);
  }

  return (await response.json()) as GroupingSessionApiResponse;
};

export const getGroupingSessionRequest = async (sessionId: string): Promise<GroupingSessionApiResponse> => {
  const response = await fetch(`/api/grouping/${sessionId}`);

  if (!response.ok) {
    throw new Error(`Could not fetch grouping session (${response.status}): ${await readErrorBody(response)}`);
  }

  return (await response.json()) as GroupingSessionApiResponse;
};

export const getGroupingProgressRequest = async (sessionId: string): Promise<GroupingProgressApiResponse> => {
  const response = await fetch(`/api/grouping/${sessionId}/progress`);

  if (!response.ok) {
    throw new Error(`Could not fetch grouping progress (${response.status}): ${await readErrorBody(response)}`);
  }

  return (await response.json()) as GroupingProgressApiResponse;
};

export const pauseGroupingSessionRequest = async (sessionId: string): Promise<GroupingSessionApiResponse> => {
  const response = await fetch(`/api/grouping/${sessionId}/pause`, { method: 'POST' });

  if (!response.ok) {
    throw new Error(`Could not pause grouping session (${response.status}): ${await readErrorBody(response)}`);
  }

  return (await response.json()) as GroupingSessionApiResponse;
};

export const resumeGroupingSessionRequest = async (sessionId: string): Promise<GroupingSessionApiResponse> => {
  const response = await fetch(`/api/grouping/${sessionId}/resume`, { method: 'POST' });

  if (!response.ok) {
    throw new Error(`Could not resume grouping session (${response.status}): ${await readErrorBody(response)}`);
  }

  return (await response.json()) as GroupingSessionApiResponse;
};
