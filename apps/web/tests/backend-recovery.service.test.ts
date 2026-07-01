import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldDelayBackendRecovery } from '../src/services/backend-recovery.service';
import { SUSTAINED_OFFLINE_DELAY_MS } from '../src/hooks/useDesktopBackendRecovery';

test('health-only outages require thirty sustained seconds before recovery UI', () => {
  assert.equal(SUSTAINED_OFFLINE_DELAY_MS, 30_000);
  assert.equal(shouldDelayBackendRecovery('offline', 'online'), true);
  assert.equal(shouldDelayBackendRecovery('online', 'online'), false);
  assert.equal(shouldDelayBackendRecovery('offline', 'offline'), false);
});
