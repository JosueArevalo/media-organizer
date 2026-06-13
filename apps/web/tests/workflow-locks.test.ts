import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CompressionSessionSnapshot } from '../src/services/compression-job.store';
import type { ExportJobSnapshot } from '../src/services/export-job.store';
import {
  hasCompressionSessionStarted,
  isGroupingReadOnlyForExport,
  isPreCompressionStepReadOnly
} from '../src/services/workflow-locks';

const createCompressionSnapshot = (
  status: CompressionSessionSnapshot['status'],
  backendSessionId: string | null = null
): CompressionSessionSnapshot => ({
  backendSessionId,
  status,
  startedAt: null,
  completedAt: null,
  imageProfileLabel: null,
  imageQuality: null,
  videoPresetLabel: null,
  outputRootLabel: null,
  errorMessage: null,
  updatedAt: 0
});

const createExportSnapshot = (status: ExportJobSnapshot['status']): ExportJobSnapshot => ({
  backendJobId: status === 'idle' ? null : 'export-1',
  status,
  sourceRoot: 'D:\\Output',
  groupingSessionId: 'grouping-1',
  destinationPath: null,
  googlePhotosAccountId: null,
  targetType: 'network-folder',
  totalItems: null,
  startedAt: null,
  completedAt: null,
  errorMessage: null,
  updatedAt: 0
});

test('pre-compression steps stay editable only before a compression session starts', () => {
  assert.equal(hasCompressionSessionStarted(createCompressionSnapshot('idle')), false);
  assert.equal(isPreCompressionStepReadOnly(createCompressionSnapshot('idle')), false);
  assert.equal(isPreCompressionStepReadOnly(createCompressionSnapshot('idle', 'session-1')), true);

  for (const status of ['running', 'paused', 'completed', 'failed'] as const) {
    assert.equal(isPreCompressionStepReadOnly(createCompressionSnapshot(status)), true);
  }
});

test('grouping is read-only only while an export is active', () => {
  assert.equal(isGroupingReadOnlyForExport([createExportSnapshot('idle')]), false);
  assert.equal(isGroupingReadOnlyForExport([createExportSnapshot('completed'), createExportSnapshot('failed')]), false);
  assert.equal(isGroupingReadOnlyForExport([createExportSnapshot('running')]), true);
  assert.equal(isGroupingReadOnlyForExport([createExportSnapshot('paused')]), true);
});
