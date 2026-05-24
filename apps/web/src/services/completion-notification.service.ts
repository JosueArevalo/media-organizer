import {
  loadCompletionNotificationSettings,
  type CompletionNotificationEventKey
} from './completion-notification-settings.store';

type CompletionNotificationPayload = {
  title: string;
  body: string;
  dedupeKey?: string;
  force?: boolean;
};

export type CompletionNotificationBlockedReason =
  | 'event-disabled'
  | 'duplicate'
  | 'no-channels-enabled'
  | 'audio-unsupported'
  | 'audio-blocked'
  | 'notification-unsupported'
  | 'notification-permission-default'
  | 'notification-permission-denied';

export type CompletionNotificationResult = {
  soundPlayed: boolean;
  browserNotificationShown: boolean;
  blockedReason: CompletionNotificationBlockedReason | null;
};

type BrowserNotificationConstructor = {
  permission: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission>;
  new(title: string, options?: NotificationOptions): Notification;
};

const DEDUPE_STORAGE_KEY = 'media-organizer-completion-notification-dedupe';
let sharedAudioContext: AudioContext | null = null;
let sharedAudioContextConstructor: typeof AudioContext | null = null;

const createResult = (
  soundPlayed: boolean,
  browserNotificationShown: boolean,
  blockedReason: CompletionNotificationBlockedReason | null = null
): CompletionNotificationResult => ({
  soundPlayed,
  browserNotificationShown,
  blockedReason
});

const getBrowserNotification = (): BrowserNotificationConstructor | null => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }

  return window.Notification as BrowserNotificationConstructor;
};

const readDedupeKeys = () => {
  if (typeof window === 'undefined') {
    return new Set<string>();
  }

  try {
    const raw = window.localStorage.getItem(DEDUPE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];

    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
};

const writeDedupeKeys = (keys: Set<string>) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(Array.from(keys).slice(-100)));
  } catch {
    // Dedupe persistence is best-effort.
  }
};

const hasDedupeKey = (dedupeKey: string) => readDedupeKeys().has(dedupeKey);

const markDedupeKey = (dedupeKey: string) => {
  const keys = readDedupeKeys();
  keys.add(dedupeKey);
  writeDedupeKeys(keys);
};

const getAudioContext = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const AudioContextConstructor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return null;
  }

  if (
    !sharedAudioContext ||
    sharedAudioContext.state === 'closed' ||
    sharedAudioContextConstructor !== AudioContextConstructor
  ) {
    sharedAudioContext = new AudioContextConstructor();
    sharedAudioContextConstructor = AudioContextConstructor;
  }

  return sharedAudioContext;
};

export const unlockCompletionNotificationAudio = async () => {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return false;
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return audioContext.state === 'running';
};

const playTone = (
  audioContext: AudioContext,
  startTime: number,
  startFrequency: number,
  endFrequency: number,
  duration: number
) => {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(startFrequency, startTime);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startTime + duration * 0.62);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.42, startTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);

  return oscillator;
};

const playCompletionSound = async () => {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return 'audio-unsupported' as const;
  }

  try {
    await unlockCompletionNotificationAudio();
  } catch {
    return 'audio-blocked' as const;
  }

  if (audioContext.state !== 'running') {
    return 'audio-blocked' as const;
  }

  const startTime = audioContext.currentTime + 0.01;
  const secondToneStart = startTime + 0.22;

  playTone(audioContext, startTime, 660, 880, 0.18);
  const finalOscillator = playTone(audioContext, secondToneStart, 880, 1174, 0.26);

  await new Promise<void>((resolve) => {
    finalOscillator.onended = () => resolve();
  });

  return 'played' as const;
};

const getNotificationBlockedReason = (permission: NotificationPermission | 'unsupported') => {
  if (permission === 'unsupported') {
    return 'notification-unsupported' as const;
  }

  if (permission === 'default') {
    return 'notification-permission-default' as const;
  }

  if (permission === 'denied') {
    return 'notification-permission-denied' as const;
  }

  return null;
};

const showBrowserNotification = (payload: CompletionNotificationPayload) => {
  const BrowserNotification = getBrowserNotification();

  if (!BrowserNotification) {
    return 'notification-unsupported' as const;
  }

  const blockedReason = getNotificationBlockedReason(BrowserNotification.permission);

  if (blockedReason) {
    return blockedReason;
  }

  new BrowserNotification(payload.title, {
    body: payload.body,
    tag: payload.dedupeKey
  });

  return 'shown' as const;
};

const getFirstBlockedReason = (reasons: CompletionNotificationBlockedReason[]) => {
  if (reasons.includes('audio-blocked')) {
    return 'audio-blocked';
  }

  return reasons[0] ?? null;
};

if (typeof window !== 'undefined') {
  const unlock = () => {
    void unlockCompletionNotificationAudio();
  };

  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export const requestBrowserNotificationPermission = async () => {
  const BrowserNotification = getBrowserNotification();

  if (!BrowserNotification?.requestPermission) {
    return 'unsupported' as const;
  }

  return BrowserNotification.requestPermission();
};

export const getBrowserNotificationPermission = () => {
  const BrowserNotification = getBrowserNotification();

  return BrowserNotification?.permission ?? 'unsupported';
};

export const notifyCompletion = async (
  eventKey: CompletionNotificationEventKey,
  payload: CompletionNotificationPayload
) => {
  if (payload.dedupeKey && hasDedupeKey(payload.dedupeKey)) {
    return createResult(false, false, 'duplicate');
  }

  const settings = loadCompletionNotificationSettings();

  if (!payload.force && !settings.events[eventKey]) {
    return createResult(false, false, 'event-disabled');
  }

  const shouldPlaySound = settings.soundEnabled;
  const shouldShowBrowserNotification = settings.browserNotificationsEnabled;
  const blockedReasons: CompletionNotificationBlockedReason[] = [];
  let soundPlayed = false;
  let browserNotificationShown = false;

  if (shouldPlaySound) {
    const soundResult = await playCompletionSound();

    if (soundResult === 'played') {
      soundPlayed = true;
    } else {
      blockedReasons.push(soundResult);
    }
  }

  if (shouldShowBrowserNotification) {
    const notificationResult = showBrowserNotification(payload);

    if (notificationResult === 'shown') {
      browserNotificationShown = true;
    } else {
      blockedReasons.push(notificationResult);
    }
  }

  if (!shouldPlaySound && !shouldShowBrowserNotification) {
    blockedReasons.push('no-channels-enabled');
  }

  if (payload.dedupeKey && (soundPlayed || browserNotificationShown)) {
    markDedupeKey(payload.dedupeKey);
  }

  return createResult(soundPlayed, browserNotificationShown, getFirstBlockedReason(blockedReasons));
};

export const testCompletionNotification = (payload: CompletionNotificationPayload) =>
  notifyCompletion('compressionCompleted', { ...payload, force: true });
