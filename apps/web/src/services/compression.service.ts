export type CompressionJobRequest = {
  name?: string;
  sourceDir: string;
  outputDir: string;
  imageQuality: number;
  imageProfileLabel: string;
  videoPresetLabel: string;
  imageToolCommand?: string;
  videoToolCommand?: string;
  selectionScope?: {
    excludedDirectories: string[];
    excludedFiles: string[];
    includedDirectories: string[];
    includedFiles: string[];
    updatedAt: number;
  } | null;
};

export type CompressionJobApiResponse = {
  job: {
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

export const startCompressionJobRequest = async (payload: CompressionJobRequest): Promise<CompressionJobApiResponse> => {
  const response = await fetch('/api/compression/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not start compression job (${response.status}): ${body}`);
  }

  return (await response.json()) as CompressionJobApiResponse;
};

export const getCompressionJobRequest = async (jobId: string): Promise<CompressionJobApiResponse> => {
  const response = await fetch(`/api/compression/jobs/${jobId}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not fetch compression job (${response.status}): ${body}`);
  }

  return (await response.json()) as CompressionJobApiResponse;
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
