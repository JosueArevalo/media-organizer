import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { notifyCompletion } from '../src/services/completion-notification.service';

const storage = new Map<string, string>();
const notifications: Array<{ title: string; options?: NotificationOptions }> = [];
const audioEvents = {
  contexts: 0,
  resumes: 0,
  oscillators: 0
};

const installWindow = ({
  permission = 'granted',
  audio = 'unsupported'
}: {
  permission?: NotificationPermission;
  audio?: 'unsupported' | 'running' | 'suspended' | 'blocked';
} = {}) => {
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  };

  class TestNotification {
    static permission = permission;
    static requestPermission = async () => TestNotification.permission;

    constructor(title: string, options?: NotificationOptions) {
      notifications.push({ title, options });
    }
  }

  class TestAudioContext {
    state: AudioContextState = audio === 'suspended' || audio === 'blocked' ? 'suspended' : 'running';
    currentTime = 1;
    destination = {};

    constructor() {
      audioEvents.contexts += 1;
    }

    resume = async () => {
      audioEvents.resumes += 1;

      if (audio === 'blocked') {
        throw new Error('blocked');
      }

      this.state = 'running';
    };

    createOscillator = () => {
      audioEvents.oscillators += 1;

      const oscillator = {
        type: 'sine',
        frequency: {
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined
        },
        connect: () => undefined,
        start: () => undefined,
        stop: () => {
          queueMicrotask(() => oscillator.onended?.());
        },
        onended: null as null | (() => void)
      };

      return oscillator;
    };

    createGain = () => ({
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined
      },
      connect: () => undefined
    });
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      Notification: TestNotification,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      AudioContext: audio === 'unsupported' ? undefined : TestAudioContext,
      webkitAudioContext: undefined
    }
  });
};

const saveNotificationSettings = (settings: {
  soundEnabled: boolean;
  browserNotificationsEnabled: boolean;
  compressionCompleted?: boolean;
}) => {
  storage.set('media-organizer-notification-settings', JSON.stringify({
    soundEnabled: settings.soundEnabled,
    browserNotificationsEnabled: settings.browserNotificationsEnabled,
    events: {
      compressionCompleted: settings.compressionCompleted ?? true,
      exportCompleted: true,
      selectionLoaded: false,
      groupingReorganized: false,
      organizationApplied: false
    }
  }));
};

afterEach(() => {
  storage.clear();
  notifications.length = 0;
  audioEvents.contexts = 0;
  audioEvents.resumes = 0;
  audioEvents.oscillators = 0;
  Reflect.deleteProperty(globalThis, 'window');
});

test('notifyCompletion does not notify when the event is disabled', async () => {
  installWindow();
  saveNotificationSettings({
    soundEnabled: false,
    browserNotificationsEnabled: true,
    compressionCompleted: false
  });

  const result = await notifyCompletion('compressionCompleted', {
    title: 'Done',
    body: 'Finished',
    dedupeKey: 'compression:1'
  });

  assert.deepEqual(result, {
    soundPlayed: false,
    browserNotificationShown: false,
    blockedReason: 'event-disabled'
  });
  assert.equal(notifications.length, 0);
});

test('notifyCompletion attempts to resume suspended audio before playing', async () => {
  installWindow({ audio: 'suspended' });
  saveNotificationSettings({
    soundEnabled: true,
    browserNotificationsEnabled: false
  });

  const result = await notifyCompletion('compressionCompleted', {
    title: 'Done',
    body: 'Finished'
  });

  assert.equal(result.soundPlayed, true);
  assert.equal(result.browserNotificationShown, false);
  assert.equal(result.blockedReason, null);
  assert.equal(audioEvents.resumes, 1);
  assert.equal(audioEvents.oscillators, 2);
});

test('notifyCompletion does not mark dedupe when every enabled channel fails', async () => {
  installWindow({ permission: 'denied', audio: 'unsupported' });
  saveNotificationSettings({
    soundEnabled: true,
    browserNotificationsEnabled: true
  });

  const first = await notifyCompletion('compressionCompleted', {
    title: 'Done',
    body: 'Finished',
    dedupeKey: 'compression:1'
  });
  const second = await notifyCompletion('compressionCompleted', {
    title: 'Done',
    body: 'Finished',
    dedupeKey: 'compression:1'
  });

  assert.equal(first.soundPlayed, false);
  assert.equal(first.browserNotificationShown, false);
  assert.equal(first.blockedReason, 'audio-unsupported');
  assert.equal(second.blockedReason, 'audio-unsupported');
});

test('notifyCompletion marks dedupe when browser notification is shown', async () => {
  installWindow({ permission: 'granted', audio: 'unsupported' });
  saveNotificationSettings({
    soundEnabled: false,
    browserNotificationsEnabled: true
  });

  const first = await notifyCompletion('compressionCompleted', {
    title: 'Done',
    body: 'Finished',
    dedupeKey: 'compression:1'
  });
  const second = await notifyCompletion('compressionCompleted', {
    title: 'Done',
    body: 'Finished',
    dedupeKey: 'compression:1'
  });

  assert.equal(first.soundPlayed, false);
  assert.equal(first.browserNotificationShown, true);
  assert.equal(first.blockedReason, null);
  assert.equal(second.blockedReason, 'duplicate');
  assert.equal(notifications.length, 1);
});

test('notifyCompletion deduplicates concurrent calls with the same key before sound finishes', async () => {
  installWindow({ audio: 'running' });
  saveNotificationSettings({
    soundEnabled: true,
    browserNotificationsEnabled: false
  });

  const results = await Promise.all([
    notifyCompletion('compressionCompleted', {
      title: 'Done',
      body: 'Finished',
      dedupeKey: 'compression:concurrent'
    }),
    notifyCompletion('compressionCompleted', {
      title: 'Done',
      body: 'Finished',
      dedupeKey: 'compression:concurrent'
    }),
    notifyCompletion('compressionCompleted', {
      title: 'Done',
      body: 'Finished',
      dedupeKey: 'compression:concurrent'
    })
  ]);

  assert.equal(results.filter((result) => result.soundPlayed).length, 1);
  assert.equal(results.filter((result) => result.blockedReason === 'duplicate').length, 2);
  assert.equal(audioEvents.oscillators, 2);
});

test('notifyCompletion respects notification permission when browser channel is enabled', async () => {
  installWindow({ permission: 'default', audio: 'unsupported' });
  saveNotificationSettings({
    soundEnabled: false,
    browserNotificationsEnabled: true
  });

  const result = await notifyCompletion('compressionCompleted', {
    title: 'Done',
    body: 'Finished'
  });

  assert.equal(result.soundPlayed, false);
  assert.equal(result.browserNotificationShown, false);
  assert.equal(result.blockedReason, 'notification-permission-default');
  assert.equal(notifications.length, 0);
});
