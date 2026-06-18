import { resolveToolCommand } from '../pipeline/compression/toolCommandResolver.js';
import { resolvePythonRuntime, type PythonRuntimeStatusSnapshot } from '../pipeline/compression/pythonCommandResolver.js';

export type ExternalToolKey = 'image' | 'imagemagick' | 'exiftool' | 'video';
export type ToolStatus = 'ready' | 'missing' | 'unknown';

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

export type ToolStatusRequest = Partial<Record<
  'imageToolCommand' | 'imageMagickCommand' | 'exifToolCommand' | 'videoToolCommand',
  string
>>;

export type ToolsStatusSnapshot = {
  platform: NodeJS.Platform;
  python: PythonRuntimeStatusSnapshot;
  tools: Record<ExternalToolKey, ExternalToolStatusSnapshot>;
};

const isUnixPlatform = (platform: NodeJS.Platform) => platform === 'darwin' || platform === 'linux';

const getInstallCommand = (platform: NodeJS.Platform, formula: string) => {
  if (platform === 'darwin') {
    return `brew install ${formula}`;
  }

  if (platform === 'linux') {
    return `brew install ${formula}`;
  }

  return null;
};

const toolDefinitions: Record<ExternalToolKey, {
  label: string;
  field: keyof ToolStatusRequest;
  defaultCommand: string;
  windowsDefaultCommand: string;
  installFormula: string;
  installUrl: string;
  note?: string;
}> = {
  image: {
    label: 'MozJPEG cjpeg',
    field: 'imageToolCommand',
    defaultCommand: 'cjpeg',
    windowsDefaultCommand: 'cjpeg-static.exe',
    installFormula: 'mozjpeg',
    installUrl: 'https://formulae.brew.sh/formula/mozjpeg',
    note: 'Homebrew installs mozjpeg as keg-only. If cjpeg is not on PATH, use the full path under your Homebrew prefix, such as /opt/homebrew/opt/mozjpeg/bin/cjpeg.'
  },
  imagemagick: {
    label: 'ImageMagick',
    field: 'imageMagickCommand',
    defaultCommand: 'magick',
    windowsDefaultCommand: 'magick.exe',
    installFormula: 'imagemagick',
    installUrl: 'https://formulae.brew.sh/formula/imagemagick'
  },
  exiftool: {
    label: 'ExifTool',
    field: 'exifToolCommand',
    defaultCommand: 'exiftool',
    windowsDefaultCommand: 'exiftool.exe',
    installFormula: 'exiftool',
    installUrl: 'https://formulae.brew.sh/formula/exiftool'
  },
  video: {
    label: 'HandBrake CLI',
    field: 'videoToolCommand',
    defaultCommand: 'HandBrakeCLI',
    windowsDefaultCommand: 'HandBrakeCLI.exe',
    installFormula: 'handbrake',
    installUrl: 'https://formulae.brew.sh/formula/handbrake'
  }
};

const getEffectiveCommand = (request: ToolStatusRequest, key: ExternalToolKey, platform: NodeJS.Platform) => {
  const definition = toolDefinitions[key];
  const configured = request[definition.field]?.trim();

  if (configured) {
    return configured;
  }

  return isUnixPlatform(platform) ? definition.defaultCommand : definition.windowsDefaultCommand;
};

export const getToolsStatus = (
  request: ToolStatusRequest = {},
  platform: NodeJS.Platform = process.platform
): ToolsStatusSnapshot => {
  const entries = (Object.keys(toolDefinitions) as ExternalToolKey[]).map((key) => {
    const definition = toolDefinitions[key];
    const effectiveCommand = getEffectiveCommand(request, key, platform);
    const resolvedPath = resolveToolCommand(effectiveCommand);

    return [key, {
      key,
      label: definition.label,
      effectiveCommand,
      resolvedPath,
      status: resolvedPath ? 'ready' : 'missing',
      installCommand: getInstallCommand(platform, definition.installFormula),
      installUrl: definition.installUrl,
      note: definition.note ?? null
    } satisfies ExternalToolStatusSnapshot] as const;
  });

  return {
    platform,
    python: resolvePythonRuntime(),
    tools: Object.fromEntries(entries) as Record<ExternalToolKey, ExternalToolStatusSnapshot>
  };
};
