export type CompletionNotificationEventKey =
  | 'compressionCompleted'
  | 'exportCompleted'
  | 'selectionLoaded'
  | 'groupingReorganized'
  | 'organizationApplied';

export type CompletionNotificationSettings = {
  soundEnabled: boolean;
  browserNotificationsEnabled: boolean;
  events: Record<CompletionNotificationEventKey, boolean>;
  updatedAt: number;
};

const STORAGE_KEY = 'media-organizer-notification-settings';
const STORAGE_EVENT_NAME = 'media-organizer-notification-settings-updated';

export const COMPLETION_NOTIFICATION_EVENT_KEYS: CompletionNotificationEventKey[] = [
  'compressionCompleted',
  'exportCompleted',
  'selectionLoaded',
  'groupingReorganized',
  'organizationApplied'
];

const DEFAULT_EVENT_SETTINGS: Record<CompletionNotificationEventKey, boolean> = {
  compressionCompleted: true,
  exportCompleted: true,
  selectionLoaded: false,
  groupingReorganized: false,
  organizationApplied: false
};

const createDefaultSettings = (): CompletionNotificationSettings => ({
  soundEnabled: true,
  browserNotificationsEnabled: false,
  events: DEFAULT_EVENT_SETTINGS,
  updatedAt: 0
});

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const normalizeEvents = (events: unknown): Record<CompletionNotificationEventKey, boolean> => {
  const parsedEvents = typeof events === 'object' && events !== null
    ? events as Partial<Record<CompletionNotificationEventKey, unknown>>
    : {};

  return COMPLETION_NOTIFICATION_EVENT_KEYS.reduce<Record<CompletionNotificationEventKey, boolean>>((accumulator, key) => {
    accumulator[key] = isBoolean(parsedEvents[key]) ? parsedEvents[key] : DEFAULT_EVENT_SETTINGS[key];
    return accumulator;
  }, { ...DEFAULT_EVENT_SETTINGS });
};

const normalizeSettings = (settings: unknown): CompletionNotificationSettings => {
  const parsedSettings = typeof settings === 'object' && settings !== null
    ? settings as Partial<CompletionNotificationSettings>
    : {};

  return {
    soundEnabled: isBoolean(parsedSettings.soundEnabled) ? parsedSettings.soundEnabled : true,
    browserNotificationsEnabled: isBoolean(parsedSettings.browserNotificationsEnabled)
      ? parsedSettings.browserNotificationsEnabled
      : false,
    events: normalizeEvents(parsedSettings.events),
    updatedAt: typeof parsedSettings.updatedAt === 'number' ? parsedSettings.updatedAt : 0
  };
};

const readSettings = (): CompletionNotificationSettings => {
  if (typeof window === 'undefined') {
    return createDefaultSettings();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return createDefaultSettings();
    }

    return normalizeSettings(JSON.parse(raw));
  } catch {
    return createDefaultSettings();
  }
};

const writeSettings = (settings: CompletionNotificationSettings) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME));
  } catch {
    // Notification settings should never block the workflow.
  }
};

export const loadCompletionNotificationSettings = () => readSettings();

export const saveCompletionNotificationSettings = (
  settings: Omit<CompletionNotificationSettings, 'updatedAt'> | CompletionNotificationSettings
) => {
  const snapshot = normalizeSettings({
    ...settings,
    updatedAt: Date.now()
  });

  writeSettings(snapshot);
  return snapshot;
};

export const subscribeCompletionNotificationSettingsChanges = (callback: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT_NAME, callback as EventListener);

  return () => window.removeEventListener(STORAGE_EVENT_NAME, callback as EventListener);
};
