import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  checkBackendHealth,
  mergeBackendHealthSnapshot,
  type BackendHealthSnapshot
} from '../src/services/backend-health.service';

const originalFetch = globalThis.fetch;

const createSnapshot = (overrides: Partial<BackendHealthSnapshot>): BackendHealthSnapshot => ({
  status: 'checking',
  lastOkAt: null,
  lastCheckedAt: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  errorMessage: null,
  ...overrides
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('checkBackendHealth reports online when the health endpoint responds', async () => {
  globalThis.fetch = async (input) => {
    assert.equal(input, '/api/health');
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  };

  const result = await checkBackendHealth();

  assert.equal(result.status, 'online');
  assert.equal(result.errorMessage, null);
  assert.equal(typeof result.lastOkAt, 'number');
  assert.equal(typeof result.lastCheckedAt, 'number');
  assert.equal(result.consecutiveFailures, 0);
  assert.equal(result.consecutiveSuccesses, 1);
});

test('checkBackendHealth reports offline without throwing when fetch fails', async () => {
  globalThis.fetch = async () => {
    throw new Error('connection refused');
  };

  const result = await checkBackendHealth();

  assert.equal(result.status, 'offline');
  assert.equal(result.lastOkAt, null);
  assert.equal(typeof result.lastCheckedAt, 'number');
  assert.equal(result.consecutiveFailures, 1);
  assert.equal(result.consecutiveSuccesses, 0);
  assert.equal(result.errorMessage, 'connection refused');
});

test('mergeBackendHealthSnapshot keeps online visible after one transient failure', () => {
  const current = createSnapshot({
    status: 'online',
    lastOkAt: 100,
    lastCheckedAt: 100,
    consecutiveFailures: 0,
    consecutiveSuccesses: 4
  });
  const probe = createSnapshot({
    status: 'offline',
    lastCheckedAt: 200,
    consecutiveFailures: 1,
    errorMessage: 'timeout'
  });

  const result = mergeBackendHealthSnapshot(current, probe);

  assert.equal(result.status, 'online');
  assert.equal(result.lastOkAt, 100);
  assert.equal(result.consecutiveFailures, 1);
  assert.equal(result.consecutiveSuccesses, 0);
  assert.equal(result.errorMessage, null);
});

test('mergeBackendHealthSnapshot shows offline after two consecutive failures', () => {
  const current = createSnapshot({
    status: 'online',
    lastOkAt: 100,
    lastCheckedAt: 200,
    consecutiveFailures: 1
  });
  const probe = createSnapshot({
    status: 'offline',
    lastCheckedAt: 300,
    consecutiveFailures: 1,
    errorMessage: 'connection refused'
  });

  const result = mergeBackendHealthSnapshot(current, probe);

  assert.equal(result.status, 'offline');
  assert.equal(result.lastOkAt, 100);
  assert.equal(result.consecutiveFailures, 2);
  assert.equal(result.consecutiveSuccesses, 0);
  assert.equal(result.errorMessage, 'connection refused');
});

test('mergeBackendHealthSnapshot recovers to online with one successful probe', () => {
  const current = createSnapshot({
    status: 'offline',
    lastOkAt: 100,
    lastCheckedAt: 300,
    consecutiveFailures: 3,
    errorMessage: 'connection refused'
  });
  const probe = createSnapshot({
    status: 'online',
    lastOkAt: 400,
    lastCheckedAt: 400,
    consecutiveSuccesses: 1
  });

  const result = mergeBackendHealthSnapshot(current, probe);

  assert.equal(result.status, 'online');
  assert.equal(result.lastOkAt, 400);
  assert.equal(result.consecutiveFailures, 0);
  assert.equal(result.consecutiveSuccesses, 1);
  assert.equal(result.errorMessage, null);
});
