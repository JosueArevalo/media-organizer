export type RuntimeMode = 'development' | 'desktop';

export type RuntimeInfo = {
  version: string;
  platform: NodeJS.Platform;
  architecture: string;
  mode: RuntimeMode;
};

export const getRuntimeMode = (): RuntimeMode =>
  process.env.MEDIA_ORGANIZER_DESKTOP === '1' ? 'desktop' : 'development';

export const getRuntimeInfo = (): RuntimeInfo => ({
  version: process.env.MEDIA_ORGANIZER_VERSION?.trim() || '0.2.0',
  platform: process.platform,
  architecture: process.arch,
  mode: getRuntimeMode()
});
