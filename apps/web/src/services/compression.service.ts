export type CompressionSessionRequest = {
  name?: string;
  sourceDir: string;
  outputDir: string;
  imageQuality: number;
  imageProfileLabel: string;
  videoPresetLabel: string;
  imageToolCommand?: string;
  videoToolCommand?: string;
  imageMagickCommand?: string;
  exifToolCommand?: string;
  selectionScope?: {
    excludedDirectories: string[];
    excludedFiles: string[];
    includedDirectories: string[];
    includedFiles: string[];
    updatedAt: number;
  } | null;
};

export type CompressionSessionApiResponse = {
  session: {
    id: string;
    status: 'draft' | 'scanned' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    sourceDir: string;
    outputDir: string;
  };
  checkpoint: {
    stage: 'scan' | 'classify' | 'compress' | 'organize';
    payloadJson: string | null;
  } | null;
  manifest?: {
    outputRoot: string;
  };
};

export type CompressionProgressApiResponse = {
  sessionId: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  currentlyProcessing: Array<{
    id: string;
    sourcePath: string;
  }>;
  processedItems: Array<{
    id: string;
    sourcePath: string;
    status: 'completed' | 'failed';
  }>;
};

export type HandBrakePresetOption = {
  category: string;
  name: string;
  description: string | null;
  isDefault: boolean;
};

export type HandBrakePresetsApiResponse = {
  status: 'ok';
  command: string;
  resolvedCommand: string;
  defaultPreset: string | null;
  presets: HandBrakePresetOption[];
};

export const startCompressionSessionRequest = async (payload: CompressionSessionRequest): Promise<CompressionSessionApiResponse> => {
  const response = await fetch('/api/compression/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not start compression session (${response.status}): ${body}`);
  }

  return (await response.json()) as CompressionSessionApiResponse;
};

export const getCompressionSessionRequest = async (sessionId: string): Promise<CompressionSessionApiResponse> => {
  const response = await fetch(`/api/compression/sessions/${sessionId}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not fetch compression session (${response.status}): ${body}`);
  }

  return (await response.json()) as CompressionSessionApiResponse;
};

export const getCompressionProgressRequest = async (sessionId: string): Promise<CompressionProgressApiResponse> => {
  const response = await fetch(`/api/compression/sessions/${sessionId}/progress`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not fetch compression progress (${response.status}): ${body}`);
  }

  return (await response.json()) as CompressionProgressApiResponse;
};

export const loadHandBrakePresetsRequest = async (command: string): Promise<HandBrakePresetsApiResponse> => {
  const response = await fetch('/api/system/tools/handbrake/presets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ command })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not load HandBrake presets (${response.status}): ${body}`);
  }

  return (await response.json()) as HandBrakePresetsApiResponse;
};
