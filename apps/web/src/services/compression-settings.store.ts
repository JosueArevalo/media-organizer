export type CompressionImagePreset = 'balanced' | 'high' | 'aggressive' | 'custom';

export type CompressionSettingsSnapshot = {
  imagePreset: CompressionImagePreset;
  customQuality: number;
  videoPreset: string;
  updatedAt: number;
};

const STORAGE_KEY = 'media-organizer-compression-settings';
const DEFAULT_VIDEO_PRESET = 'Fast 1080p30';

const IMAGE_PRESETS = new Set<CompressionImagePreset>(['balanced', 'high', 'aggressive', 'custom']);

const clampQuality = (value: number) => {
  if (Number.isNaN(value)) {
    return 72;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
};

const createDefaultSnapshot = (): CompressionSettingsSnapshot => ({
  imagePreset: 'balanced',
  customQuality: 72,
  videoPreset: DEFAULT_VIDEO_PRESET,
  updatedAt: 0
});

const normalizeSnapshot = (value: Partial<CompressionSettingsSnapshot> | null): CompressionSettingsSnapshot => {
  const defaultSnapshot = createDefaultSnapshot();
  const imagePreset = IMAGE_PRESETS.has(value?.imagePreset as CompressionImagePreset)
    ? value?.imagePreset as CompressionImagePreset
    : defaultSnapshot.imagePreset;
  const customQuality = typeof value?.customQuality === 'number'
    ? value.customQuality
    : defaultSnapshot.customQuality;
  const videoPreset = typeof value?.videoPreset === 'string' && value.videoPreset.trim().length > 0
    ? value.videoPreset
    : defaultSnapshot.videoPreset;

  return {
    imagePreset,
    customQuality: clampQuality(customQuality),
    videoPreset,
    updatedAt: value?.updatedAt ?? defaultSnapshot.updatedAt
  };
};

export const loadCompressionSettings = (): CompressionSettingsSnapshot => {
  if (typeof window === 'undefined') {
    return createDefaultSnapshot();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return createDefaultSnapshot();
    }

    return normalizeSnapshot(JSON.parse(raw) as Partial<CompressionSettingsSnapshot>);
  } catch {
    return createDefaultSnapshot();
  }
};

export const saveCompressionSettings = (settings: Omit<CompressionSettingsSnapshot, 'updatedAt'>) => {
  const snapshot = normalizeSnapshot({
    ...settings,
    updatedAt: Date.now()
  });

  if (typeof window === 'undefined') {
    return snapshot;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Keep the in-page state usable when localStorage is unavailable.
  }

  return snapshot;
};
