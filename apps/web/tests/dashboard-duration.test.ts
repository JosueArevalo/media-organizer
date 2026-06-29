import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCompressionDuration } from '../src/pages/dashboard-duration';
import type { DashboardExecution } from '../src/services/dashboard.service';
import type { TranslationKey } from '../src/i18n';

const t = (key: TranslationKey) => {
  const labels: Partial<Record<TranslationKey, string>> = {
    'dashboard.duration.hour': 'hour',
    'dashboard.duration.hours': 'hours',
    'dashboard.duration.minute': 'minute',
    'dashboard.duration.minutes': 'minutes',
    'dashboard.duration.second': 'second',
    'dashboard.duration.seconds': 'seconds'
  };

  return labels[key] ?? key;
};

const createExecution = (overrides: Partial<DashboardExecution> = {}): DashboardExecution => ({
  id: 'execution-1',
  sessionId: 'session-1',
  groupingSessionId: null,
  name: 'Test execution',
  sourceDir: 'D:\\source',
  outputDir: 'D:\\output',
  outputRoot: 'D:\\output',
  status: 'running',
  startedAt: '2026-06-25T17:19:00.000Z',
  finishedAt: null,
  updatedAt: '2026-06-25T18:22:00.000Z',
  totalItems: 10,
  imageItems: 8,
  videoItems: 2,
  completedItems: 6,
  failedItems: 0,
  originalBytes: null,
  finalBytes: null,
  compressionActiveDurationMs: null,
  compressionActiveStartedAt: null,
  imageProfileLabel: null,
  imageQuality: null,
  videoPresetLabel: null,
  errorSummary: [],
  groupingStatus: null,
  groupingTotalItems: 0,
  groupingCompletedItems: 0,
  groupingFailedItems: 0,
  verification: {
    status: 'not_verified',
    expected: { total: 0, images: 0, videos: 0, unknown: 0 },
    destination: { total: 0, images: 0, videos: 0, unknown: 0 },
    verifiedAt: null,
    outputRoot: null
  },
  exports: [],
  ...overrides
});

test('formatCompressionDuration uses persisted active duration without double-counting open segments', () => {
  const execution = createExecution({
    compressionActiveDurationMs: 3_657_000,
    compressionActiveStartedAt: '2026-06-25T17:19:00.000Z'
  });

  assert.equal(formatCompressionDuration(execution, t), '1 hour 0 minutes 57 seconds');
});

test('formatCompressionDuration uses persisted duration for completed executions', () => {
  const execution = createExecution({
    status: 'completed',
    finishedAt: '2026-06-25T18:22:00.000Z',
    compressionActiveDurationMs: 3_780_000,
    compressionActiveStartedAt: null
  });

  assert.equal(formatCompressionDuration(execution, t), '1 hour 3 minutes');
});

test('formatCompressionDuration falls back to timestamps for legacy executions', () => {
  const execution = createExecution({
    status: 'completed',
    startedAt: '2026-06-25T17:19:00.000Z',
    finishedAt: '2026-06-25T18:22:00.000Z'
  });

  assert.equal(formatCompressionDuration(execution, t), '1 hour 3 minutes');
});
