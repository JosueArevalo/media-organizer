export type EncoderSettingsSnapshot = {
  imageToolCommand: string;
  videoToolCommand: string;
  imageMagickCommand: string;
  exifToolCommand: string;
  updatedAt: number;
};

const STORAGE_KEY = 'encoderSettings';
const STORAGE_EVENT_TYPE = 'encoderSettingsChanged';

const getDefaultSettings = (): EncoderSettingsSnapshot => ({
  imageToolCommand: '',
  videoToolCommand: '',
  imageMagickCommand: '',
  exifToolCommand: '',
  updatedAt: 0
});

const normalizeSettings = (value: Partial<EncoderSettingsSnapshot> | null): EncoderSettingsSnapshot => ({
  imageToolCommand: value?.imageToolCommand ?? '',
  videoToolCommand: value?.videoToolCommand ?? '',
  imageMagickCommand: value?.imageMagickCommand ?? '',
  exifToolCommand: value?.exifToolCommand ?? '',
  updatedAt: value?.updatedAt ?? 0
});

export const loadEncoderSettings = async (): Promise<EncoderSettingsSnapshot> => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return getDefaultSettings();
    }
    return normalizeSettings(JSON.parse(stored) as Partial<EncoderSettingsSnapshot>);
  } catch {
    console.warn('Failed to load encoder settings from localStorage');
    return getDefaultSettings();
  }
};

export const saveEncoderSettings = async (settings: Omit<EncoderSettingsSnapshot, 'updatedAt'>) => {
  const snapshot: EncoderSettingsSnapshot = {
    ...settings,
    updatedAt: Date.now()
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));

  // Dispatch custom event for cross-component sync
  window.dispatchEvent(
    new CustomEvent(STORAGE_EVENT_TYPE, {
      detail: snapshot
    })
  );
};

export const clearEncoderSettings = async () => {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(
    new CustomEvent(STORAGE_EVENT_TYPE, {
      detail: getDefaultSettings()
    })
  );
};

export const subscribeToEncoderSettingsChanges = (callback: (settings: EncoderSettingsSnapshot) => void) => {
  const handleChange = (event: Event) => {
    if (event instanceof CustomEvent) {
      callback(event.detail as EncoderSettingsSnapshot);
    }
  };

  window.addEventListener(STORAGE_EVENT_TYPE, handleChange);

  return () => {
    window.removeEventListener(STORAGE_EVENT_TYPE, handleChange);
  };
};
