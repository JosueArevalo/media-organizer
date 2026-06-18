import type { EncoderSettingsSnapshot } from './encoder-settings.store';

export type ToolStatus = 'ready' | 'missing' | 'unknown';
export type ExternalToolKey = 'image' | 'imagemagick' | 'exiftool' | 'video';
export type RuntimePlatform = 'win32' | 'darwin' | 'linux' | string;

export type ExternalToolStatusSnapshot = {
  key: ExternalToolKey;
  label: string;
  effectiveCommand: string;
  resolvedPath: string | null;
  status: ToolStatus;
  installCommand: string | null;
  installUrl: string;
  note: string | null;
};

export type PythonRuntimeStatusSnapshot = {
  command: string;
  resolvedPath: string | null;
  status: 'ready' | 'missing';
  candidates: string[];
};

export type ToolsStatusSnapshot = {
  platform: RuntimePlatform;
  python: PythonRuntimeStatusSnapshot;
  tools: Record<ExternalToolKey, ExternalToolStatusSnapshot>;
};

type EncoderCommandField = Exclude<keyof EncoderSettingsSnapshot, 'updatedAt'>;

const settingsFields: Record<ExternalToolKey, EncoderCommandField> = {
  image: 'imageToolCommand',
  imagemagick: 'imageMagickCommand',
  exiftool: 'exifToolCommand',
  video: 'videoToolCommand'
};

const unixDefaults: Record<ExternalToolKey, string> = {
  image: 'cjpeg',
  imagemagick: 'magick',
  exiftool: 'exiftool',
  video: 'HandBrakeCLI'
};

export const getRuntimePlatform = (): RuntimePlatform => {
  if (typeof navigator !== 'undefined') {
    const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();

    if (platform.includes('mac')) return 'darwin';
    if (platform.includes('win')) return 'win32';
    if (platform.includes('linux')) return 'linux';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform;
  }

  return 'unknown';
};

export const isWindowsPlatform = (platform: RuntimePlatform = getRuntimePlatform()) => platform === 'win32';

export const isUnixPlatform = (platform: RuntimePlatform = getRuntimePlatform()) =>
  platform === 'darwin' || platform === 'linux';

export const getEffectiveToolCommand = (
  key: ExternalToolKey,
  settings: EncoderSettingsSnapshot,
  platform: RuntimePlatform = getRuntimePlatform()
) => {
  const configured = settings[settingsFields[key]].trim();

  if (configured) {
    return configured;
  }

  return isUnixPlatform(platform) ? unixDefaults[key] : '';
};

export const loadToolsStatusRequest = async (
  settings: EncoderSettingsSnapshot
): Promise<ToolsStatusSnapshot> => {
  const response = await fetch('/api/system/tools/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      imageToolCommand: settings.imageToolCommand,
      imageMagickCommand: settings.imageMagickCommand,
      exifToolCommand: settings.exifToolCommand,
      videoToolCommand: settings.videoToolCommand
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tool status request failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<ToolsStatusSnapshot>;
};
