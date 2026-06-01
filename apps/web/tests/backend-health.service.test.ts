import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  DEFAULT_BACKEND_HEALTH_OFFLINE_FAILURE_THRESHOLD,
  DEFAULT_BACKEND_HEALTH_TIMEOUT_FAILURE_THRESHOLD,
  DEFAULT_BACKEND_HEALTH_TIMEOUT_MS,
  checkBackendHealth,
  mergeBackendHealthSnapshot,
  resolveBackendApiUrl,
  type BackendHealthSnapshot
} from '../src/services/backend-health.service';

const originalFetch = globalThis.fetch;

const createSnapshot = (overrides: Partial<BackendHealthSnapshot>): BackendHealthSnapshot => ({
  status: 'checking',
  lastOkAt: null,
  lastCheckedAt: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  failureKind: null,
  errorMessage: null,
  ...overrides
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('backend health defaults balance quick detection and transient failure tolerance', () => {
  assert.equal(DEFAULT_BACKEND_HEALTH_TIMEOUT_MS, 1500);
  assert.equal(DEFAULT_BACKEND_HEALTH_OFFLINE_FAILURE_THRESHOLD, 2);
  assert.equal(DEFAULT_BACKEND_HEALTH_TIMEOUT_FAILURE_THRESHOLD, 4);
});

test('resolveBackendApiUrl uses configured backend URL first', () => {
  assert.equal(
    resolveBackendApiUrl('/api/health', {
      DEV: true,
      VITE_BACKEND_URL: 'http://127.0.0.1:4100/'
    }),
    'http://127.0.0.1:4100/api/health'
  );
});

test('resolveBackendApiUrl uses direct backend URL in dev without explicit config', () => {
  assert.equal(
    resolveBackendApiUrl('/api/health', {
      DEV: true
    }),
    'http://localhost:4000/api/health'
  );
});

test('resolveBackendApiUrl uses relative API path outside dev without explicit config', () => {
  assert.equal(
    resolveBackendApiUrl('/api/health', {
      DEV: false
    }),
    '/api/health'
  );
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
  assert.equal(result.failureKind, null);
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
  assert.equal(result.failureKind, 'network');
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
    failureKind: 'timeout',
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
    failureKind: 'network',
    errorMessage: 'connection refused'
  });

  const result = mergeBackendHealthSnapshot(current, probe);

  assert.equal(result.status, 'offline');
  assert.equal(result.lastOkAt, 100);
  assert.equal(result.consecutiveFailures, 2);
  assert.equal(result.consecutiveSuccesses, 0);
  assert.equal(result.errorMessage, 'connection refused');
});

test('mergeBackendHealthSnapshot tolerates repeated timeout probes before showing offline', () => {
  const current = createSnapshot({
    status: 'online',
    lastOkAt: 100,
    lastCheckedAt: 300,
    consecutiveFailures: 2
  });
  const probe = createSnapshot({
    status: 'offline',
    lastCheckedAt: 400,
    consecutiveFailures: 1,
    failureKind: 'timeout',
    errorMessage: 'The operation was aborted.'
  });

  const result = mergeBackendHealthSnapshot(current, probe);

  assert.equal(result.status, 'online');
  assert.equal(result.lastOkAt, 100);
  assert.equal(result.consecutiveFailures, 3);
  assert.equal(result.errorMessage, null);
});

test('mergeBackendHealthSnapshot eventually shows offline after sustained timeout probes', () => {
  const current = createSnapshot({
    status: 'online',
    lastOkAt: 100,
    lastCheckedAt: 400,
    consecutiveFailures: 3
  });
  const probe = createSnapshot({
    status: 'offline',
    lastCheckedAt: 500,
    consecutiveFailures: 1,
    failureKind: 'timeout',
    errorMessage: 'The operation was aborted.'
  });

  const result = mergeBackendHealthSnapshot(current, probe);

  assert.equal(result.status, 'offline');
  assert.equal(result.lastOkAt, 100);
  assert.equal(result.consecutiveFailures, 4);
  assert.equal(result.errorMessage, 'The operation was aborted.');
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
