export type OnboardingSnapshot = {
  dismissedAt: number;
  version: number;
};

const STORAGE_KEY = 'media-organizer-dashboard-onboarding';
const ONBOARDING_VERSION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeSnapshot = (value: unknown): OnboardingSnapshot | null => {
  if (!isRecord(value)) {
    return null;
  }

  const dismissedAt = value.dismissedAt;
  const version = value.version;

  if (typeof dismissedAt !== 'number' || !Number.isFinite(dismissedAt) || dismissedAt <= 0) {
    return null;
  }

  if (version !== ONBOARDING_VERSION) {
    return null;
  }

  return {
    dismissedAt,
    version: ONBOARDING_VERSION
  };
};

export const loadOnboardingSnapshot = (): OnboardingSnapshot | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const shouldShowOnboarding = () => loadOnboardingSnapshot() === null;

export const dismissOnboarding = (): OnboardingSnapshot => {
  const snapshot: OnboardingSnapshot = {
    dismissedAt: Date.now(),
    version: ONBOARDING_VERSION
  };

  if (typeof window === 'undefined') {
    return snapshot;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore persistence failures and keep the UI usable.
  }

  return snapshot;
};

export const resetOnboarding = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore persistence failures during reset.
  }
};
