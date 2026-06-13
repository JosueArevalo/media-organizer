import { randomUUID } from 'node:crypto';
import { getDb } from '../state/db.js';
import { runMigrations } from '../state/migrations/runMigrations.js';
import type { SessionRecord } from '../state/dto/state.types.js';
import { listExportProviderSummaries } from '../pipeline/export/exportSummary.service.js';
import type { ExportProviderSummary } from '../pipeline/export/export.types.js';

type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type VerificationCounts = {
  total: number;
  images: number;
  videos: number;
  unknown: number;
};

export type ExecutionVerificationStatus = 'ok' | 'mismatch' | 'not_verified';

export type ExecutionVerification = {
  status: ExecutionVerificationStatus;
  expected: VerificationCounts;
  destination: VerificationCounts;
  verifiedAt: string | null;
  outputRoot: string | null;
};

export type ExecutionHistoryInput = {
  sessionId: string;
  name: string | null;
  sourceDir: string;
  outputDir: string;
  outputRoot: string | null;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string | null;
  updatedAt: string;
  totalItems: number;
  imageItems: number;
  videoItems: number;
  completedItems: number;
  failedItems: number;
  originalBytes?: number | null;
  finalBytes?: number | null;
  compressionActiveDurationMs?: number | null;
  compressionActiveStartedAt?: string | null;
  imageProfileLabel: string | null;
  imageQuality?: number | null;
  videoPresetLabel: string | null;
  errorSummary: Array<{ source: string; error: string | null }>;
};

export type ExecutionHistoryRecord = {
  id: string;
  sessionId: string;
  groupingSessionId: string | null;
  name: string | null;
  sourceDir: string;
  outputDir: string;
  outputRoot: string | null;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
  totalItems: number;
  imageItems: number;
  videoItems: number;
  completedItems: number;
  failedItems: number;
  originalBytes: number | null;
  finalBytes: number | null;
  compressionActiveDurationMs: number | null;
  compressionActiveStartedAt: string | null;
  imageProfileLabel: string | null;
  imageQuality: number | null;
  videoPresetLabel: string | null;
  errorSummary: Array<{ source: string; error: string | null }>;
  groupingStatus: ExecutionStatus | null;
  groupingTotalItems: number;
  groupingCompletedItems: number;
  groupingFailedItems: number;
  verification: ExecutionVerification;
  exports: ExportProviderSummary[];
};

export type DashboardSummary = {
  currentExecution: ExecutionHistoryRecord | null;
  lastExecution: ExecutionHistoryRecord | null;
  totals: {
    executions: number;
    completedExecutions: number;
    failedExecutions: number;
    filesProcessed: number;
    failedItems: number;
  };
  alerts: Array<{
    id: string;
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
};

type ExecutionHistoryRow = {
  id: string;
  session_id: string;
  grouping_session_id: string | null;
  name: string | null;
  source_dir: string;
  output_dir: string;
  output_root: string | null;
  status: ExecutionStatus;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
  total_items: number;
  image_items: number;
  video_items: number;
  completed_items: number;
  failed_items: number;
  original_bytes: number | null;
  final_bytes: number | null;
  compression_active_duration_ms: number | null;
  compression_active_started_at: string | null;
  image_profile_label: string | null;
  image_quality: number | null;
  video_preset_label: string | null;
  error_summary_json: string | null;
  grouping_status: ExecutionStatus | null;
  grouping_total_items: number;
  grouping_completed_items: number;
  grouping_failed_items: number;
  verification_json: string | null;
};

const EMPTY_COUNTS: VerificationCounts = {
  total: 0,
  images: 0,
  videos: 0,
  unknown: 0
};

export const createNotVerifiedSnapshot = (outputRoot: string | null = null): ExecutionVerification => ({
  status: 'not_verified',
  expected: { ...EMPTY_COUNTS },
  destination: { ...EMPTY_COUNTS },
  verifiedAt: null,
  outputRoot
});

const toStatus = (status: string): ExecutionStatus => {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    return status;
  }

  return 'running';
};

const parseErrorSummary = (value: string | null): Array<{ source: string; error: string | null }> => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is { source: string; error?: string | null } => Boolean(item && typeof item === 'object' && typeof (item as { source?: unknown }).source === 'string'))
      .map((item) => ({ source: item.source, error: item.error ?? null }));
  } catch {
    return [];
  }
};

const isVerificationCounts = (value: unknown): value is VerificationCounts => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<VerificationCounts>;
  return (
    typeof candidate.total === 'number' &&
    typeof candidate.images === 'number' &&
    typeof candidate.videos === 'number' &&
    typeof candidate.unknown === 'number'
  );
};

const parseVerification = (value: string | null, outputRoot: string | null): ExecutionVerification => {
  if (!value) {
    return createNotVerifiedSnapshot(outputRoot);
  }

  try {
    const parsed = JSON.parse(value) as Partial<ExecutionVerification>;
    const status = parsed.status === 'ok' || parsed.status === 'mismatch' || parsed.status === 'not_verified'
      ? parsed.status
      : 'not_verified';

    return {
      status,
      expected: isVerificationCounts(parsed.expected) ? parsed.expected : { ...EMPTY_COUNTS },
      destination: isVerificationCounts(parsed.destination) ? parsed.destination : { ...EMPTY_COUNTS },
      verifiedAt: typeof parsed.verifiedAt === 'string' ? parsed.verifiedAt : null,
      outputRoot: typeof parsed.outputRoot === 'string' ? parsed.outputRoot : outputRoot
    };
  } catch {
    return createNotVerifiedSnapshot(outputRoot);
  }
};

const toExecution = (row: ExecutionHistoryRow): ExecutionHistoryRecord => ({
  id: row.id,
  sessionId: row.session_id,
  groupingSessionId: row.grouping_session_id,
  name: row.name,
  sourceDir: row.source_dir,
  outputDir: row.output_dir,
  outputRoot: row.output_root,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  updatedAt: row.updated_at,
  totalItems: row.total_items,
  imageItems: row.image_items,
  videoItems: row.video_items,
  completedItems: row.completed_items,
  failedItems: row.failed_items,
  originalBytes: row.original_bytes,
  finalBytes: row.final_bytes,
  compressionActiveDurationMs: row.compression_active_duration_ms,
  compressionActiveStartedAt: row.compression_active_started_at,
  imageProfileLabel: row.image_profile_label,
  imageQuality: row.image_quality,
  videoPresetLabel: row.video_preset_label,
  errorSummary: parseErrorSummary(row.error_summary_json),
  groupingStatus: row.grouping_status,
  groupingTotalItems: row.grouping_total_items,
  groupingCompletedItems: row.grouping_completed_items,
  groupingFailedItems: row.grouping_failed_items,
  verification: parseVerification(row.verification_json, row.output_root),
  exports: listExportProviderSummaries({ executionId: row.id })
});

const listExecutionRows = () => {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT
          id,
          session_id,
          grouping_session_id,
          name,
          source_dir,
          output_dir,
          output_root,
          status,
          started_at,
          finished_at,
          updated_at,
          total_items,
          image_items,
          video_items,
          completed_items,
          failed_items,
          original_bytes,
          final_bytes,
          compression_active_duration_ms,
          compression_active_started_at,
          image_profile_label,
          image_quality,
          video_preset_label,
          error_summary_json,
          grouping_status,
          grouping_total_items,
          grouping_completed_items,
          grouping_failed_items,
          verification_json
        FROM execution_history
        ORDER BY datetime(updated_at) DESC
      `
    )
    .all() as ExecutionHistoryRow[];
};

export const upsertExecutionHistory = (input: ExecutionHistoryInput): ExecutionHistoryRecord => {
  runMigrations();
  const db = getDb();
  const existing = db.prepare('SELECT id, created_at FROM execution_history WHERE session_id = ?').get(input.sessionId) as
    | { id: string; created_at: string }
    | undefined;
  const id = existing?.id ?? randomUUID();
  const createdAt = existing?.created_at ?? input.startedAt;

  db.prepare(
    `
      INSERT INTO execution_history (
        id,
        session_id,
        name,
        source_dir,
        output_dir,
        output_root,
        status,
        started_at,
        finished_at,
        updated_at,
        total_items,
        image_items,
        video_items,
        completed_items,
        failed_items,
        original_bytes,
        final_bytes,
        compression_active_duration_ms,
        compression_active_started_at,
        image_profile_label,
        image_quality,
        video_preset_label,
        error_summary_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        name = excluded.name,
        source_dir = excluded.source_dir,
        output_dir = excluded.output_dir,
        output_root = excluded.output_root,
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        updated_at = excluded.updated_at,
        total_items = excluded.total_items,
        image_items = excluded.image_items,
        video_items = excluded.video_items,
        completed_items = excluded.completed_items,
        failed_items = excluded.failed_items,
        original_bytes = excluded.original_bytes,
        final_bytes = excluded.final_bytes,
        compression_active_duration_ms = excluded.compression_active_duration_ms,
        compression_active_started_at = excluded.compression_active_started_at,
        image_profile_label = excluded.image_profile_label,
        image_quality = excluded.image_quality,
        video_preset_label = excluded.video_preset_label,
        error_summary_json = excluded.error_summary_json
    `
  ).run(
    id,
    input.sessionId,
    input.name,
    input.sourceDir,
    input.outputDir,
    input.outputRoot,
    input.status,
    input.startedAt,
    input.finishedAt ?? null,
    input.updatedAt,
    input.totalItems,
    input.imageItems,
    input.videoItems,
    input.completedItems,
    input.failedItems,
    input.originalBytes ?? null,
    input.finalBytes ?? null,
    input.compressionActiveDurationMs ?? null,
    input.compressionActiveStartedAt ?? null,
    input.imageProfileLabel,
    input.imageQuality ?? null,
    input.videoPresetLabel,
    JSON.stringify(input.errorSummary.slice(0, 10)),
    createdAt
  );

  const row = db.prepare('SELECT * FROM execution_history WHERE session_id = ?').get(input.sessionId) as ExecutionHistoryRow;
  return toExecution(row);
};

export const linkGroupingExecution = (compressionSessionId: string, groupingSessionId: string) => {
  runMigrations();
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
      UPDATE execution_history
      SET grouping_session_id = ?, grouping_status = 'running', updated_at = ?
      WHERE session_id = ?
    `
  ).run(groupingSessionId, now, compressionSessionId);
};

export const updateGroupingExecutionSummary = (input: {
  compressionSessionId: string | null;
  groupingSessionId: string;
  status: ExecutionStatus;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  updatedAt: string;
}) => {
  if (!input.compressionSessionId) {
    return;
  }

  runMigrations();
  const db = getDb();
  db.prepare(
    `
      UPDATE execution_history
      SET
        grouping_session_id = ?,
        grouping_status = ?,
        grouping_total_items = ?,
        grouping_completed_items = ?,
        grouping_failed_items = ?,
        updated_at = ?
      WHERE session_id = ?
    `
  ).run(
    input.groupingSessionId,
    input.status,
    input.totalItems,
    input.completedItems,
    input.failedItems,
    input.updatedAt,
    input.compressionSessionId
  );
};

export const updateExecutionVerification = (compressionSessionId: string | null, verification: ExecutionVerification) => {
  if (!compressionSessionId) {
    return;
  }

  runMigrations();
  const db = getDb();
  db.prepare(
    `
      UPDATE execution_history
      SET verification_json = ?, updated_at = ?
      WHERE session_id = ?
    `
  ).run(JSON.stringify(verification), verification.verifiedAt ?? new Date().toISOString(), compressionSessionId);
};

export const listExecutionHistory = (): ExecutionHistoryRecord[] => {
  runMigrations();
  return listExecutionRows().map(toExecution);
};

export const deleteExecutionHistory = (id: string): boolean => {
  runMigrations();
  const db = getDb();
  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare('UPDATE export_jobs SET execution_id = NULL WHERE execution_id = ?').run(id);
    const result = db.prepare('DELETE FROM execution_history WHERE id = ?').run(id);
    db.exec('COMMIT');
    return result.changes > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

const getActiveRuntimeSession = (): SessionRecord | null => {
  const db = getDb();
  const row = db
    .prepare(
      `
        SELECT id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at
        FROM sessions
        WHERE status IN ('running', 'paused')
        ORDER BY datetime(updated_at) DESC
        LIMIT 1
      `
    )
    .get() as
    | {
        id: string;
        name: string | null;
        source_dir: string;
        output_dir: string;
        status: SessionRecord['status'];
        created_at: string;
        updated_at: string;
        last_opened_at: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    sourceDir: row.source_dir,
    outputDir: row.output_dir,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at
  };
};

export const getDashboardSummary = (): DashboardSummary => {
  runMigrations();
  const executions = listExecutionRows().map(toExecution);
  const activeRuntimeSession = getActiveRuntimeSession();
  const currentExecution =
    executions.find((execution) => execution.status === 'running' || execution.groupingStatus === 'running') ??
    (activeRuntimeSession
      ? {
          id: activeRuntimeSession.id,
          sessionId: activeRuntimeSession.id,
          groupingSessionId: null,
          name: activeRuntimeSession.name,
          sourceDir: activeRuntimeSession.sourceDir,
          outputDir: activeRuntimeSession.outputDir,
          outputRoot: null,
          status: toStatus(activeRuntimeSession.status),
          startedAt: activeRuntimeSession.createdAt,
          finishedAt: null,
          updatedAt: activeRuntimeSession.updatedAt,
          totalItems: 0,
          imageItems: 0,
          videoItems: 0,
          completedItems: 0,
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
          verification: createNotVerifiedSnapshot(null),
          exports: listExportProviderSummaries({ executionId: activeRuntimeSession.id })
      }
      : null);
  const lastExecution = executions.find((execution) => execution.id !== currentExecution?.id && execution.status !== 'running') ?? executions[0] ?? null;
  const failedExecutions = executions.filter((execution) => execution.status === 'failed').length;
  const alerts: DashboardSummary['alerts'] = [];

  if (currentExecution) {
    alerts.push({
      id: 'current-execution',
      level: 'info',
      message: 'There is an execution in progress.'
    });
  }

  if (currentExecution?.status === 'failed') {
    alerts.push({
      id: 'current-failed',
      level: 'error',
      message: 'The current workflow has errors.'
    });
  }

  if (currentExecution && (currentExecution.failedItems > 0 || currentExecution.groupingFailedItems > 0)) {
    alerts.push({
      id: 'failed-items',
      level: 'warning',
      message: 'Some media items need attention.'
    });
  }

  return {
    currentExecution,
    lastExecution,
    totals: {
      executions: executions.length,
      completedExecutions: executions.filter((execution) => execution.status === 'completed').length,
      failedExecutions,
      filesProcessed: executions.reduce((total, execution) => total + execution.completedItems, 0),
      failedItems: executions.reduce((total, execution) => total + execution.failedItems + execution.groupingFailedItems, 0)
    },
    alerts
  };
};
