import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  dismissOnboarding,
  loadOnboardingSnapshot,
  resetOnboarding,
  shouldShowOnboarding
} from '../src/services/dashboard-onboarding.store';

const storage = new Map<string, string>();

const installWindow = () => {
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage }
  });
};

afterEach(() => {
  storage.clear();
  Reflect.deleteProperty(globalThis, 'window');
});

test('onboarding shows by default when there is no stored snapshot', () => {
  installWindow();

  assert.equal(loadOnboardingSnapshot(), null);
  assert.equal(shouldShowOnboarding(), true);
});

test('dismissOnboarding persists the current onboarding version', () => {
  installWindow();

  const snapshot = dismissOnboarding();

  assert.ok(snapshot.dismissedAt > 0);
  assert.equal(snapshot.version, 1);
  assert.equal(shouldShowOnboarding(), false);
  assert.deepEqual(loadOnboardingSnapshot(), snapshot);
});

test('invalid onboarding JSON falls back to visible onboarding', () => {
  installWindow();
  storage.set('media-organizer-dashboard-onboarding', '{broken');

  assert.equal(loadOnboardingSnapshot(), null);
  assert.equal(shouldShowOnboarding(), true);
});

test('resetOnboarding removes the stored dismissal snapshot', () => {
  installWindow();
  dismissOnboarding();

  resetOnboarding();

  assert.equal(storage.has('media-organizer-dashboard-onboarding'), false);
  assert.equal(shouldShowOnboarding(), true);
});
