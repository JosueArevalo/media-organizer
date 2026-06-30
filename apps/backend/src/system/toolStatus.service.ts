import { resolveToolCommand } from '../pipeline/compression/toolCommandResolver.js';
import { resolvePythonRuntime, type PythonRuntimeStatusSnapshot } from '../pipeline/compression/pythonCommandResolver.js';

export type ExternalToolKey = 'image' | 'png' | 'imagemagick' | 'exiftool' | 'video';
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
  'imageToolCommand' | 'pngToolCommand' | 'imageMagickCommand' | 'exifToolCommand' | 'videoToolCommand',
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

const getMozJpegNote = (platform: NodeJS.Platform) => {
  if (platform === 'linux') {
    return 'Homebrew installs mozjpeg as keg-only. It is detected under the Linuxbrew prefix; the usual path is /home/linuxbrew/.linuxbrew/opt/mozjpeg/bin/cjpeg.';
  }

  if (platform === 'darwin') {
    return 'Homebrew installs mozjpeg as keg-only. It is detected under the Homebrew prefix, usually /opt/homebrew on Apple Silicon or /usr/local on Intel Macs.';
  }

  return undefined;
};

const toolDefinitions: Record<ExternalToolKey, {
  label: string;
  field: keyof ToolStatusRequest;
  defaultCommand: string;
  installFormula: string;
  installUrl: string;
}> = {
  image: {
    label: 'MozJPEG cjpeg',
    field: 'imageToolCommand',
    defaultCommand: 'cjpeg',
    installFormula: 'mozjpeg',
    installUrl: 'https://formulae.brew.sh/formula/mozjpeg'
  },
  png: {
    label: 'pngquant',
    field: 'pngToolCommand',
    defaultCommand: 'pngquant',
    installFormula: 'pngquant',
    installUrl: 'https://pngquant.org/'
  },
  imagemagick: {
    label: 'ImageMagick',
    field: 'imageMagickCommand',
    defaultCommand: 'magick',
    installFormula: 'imagemagick',
    installUrl: 'https://formulae.brew.sh/formula/imagemagick'
  },
  exiftool: {
    label: 'ExifTool',
    field: 'exifToolCommand',
    defaultCommand: 'exiftool',
    installFormula: 'exiftool',
    installUrl: 'https://formulae.brew.sh/formula/exiftool'
  },
  video: {
    label: 'HandBrake CLI',
    field: 'videoToolCommand',
    defaultCommand: 'HandBrakeCLI',
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

  return isUnixPlatform(platform) ? definition.defaultCommand : '';
};

export const getToolsStatus = (
  request: ToolStatusRequest = {},
  platform: NodeJS.Platform = process.platform
): ToolsStatusSnapshot => {
  const entries = (Object.keys(toolDefinitions) as ExternalToolKey[]).map((key) => {
    const definition = toolDefinitions[key];
    const effectiveCommand = getEffectiveCommand(request, key, platform);
    const resolvedPath = resolveToolCommand(effectiveCommand, { platform });

    return [key, {
      key,
      label: definition.label,
      effectiveCommand,
      resolvedPath,
      status: resolvedPath ? 'ready' : 'missing',
      installCommand: getInstallCommand(platform, definition.installFormula),
      installUrl: definition.installUrl,
      note: key === 'image' ? getMozJpegNote(platform) ?? null : null
    } satisfies ExternalToolStatusSnapshot] as const;
  });

  return {
    platform,
    python: resolvePythonRuntime(),
    tools: Object.fromEntries(entries) as Record<ExternalToolKey, ExternalToolStatusSnapshot>
  };
};
