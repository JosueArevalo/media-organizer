import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import type {
  ExportCoverageStatus,
  ExportDestinationSummary,
  ExportJobStatus,
  ExportProviderSummary,
  ExportTargetType
} from './export.types.js';

const PROVIDERS: ExportTargetType[] = ['network-folder', 'google-photos'];

type ExportSummaryJobRow = {
  id: string;
  target_type: ExportTargetType;
  destination_label: string | null;
  status: ExportJobStatus;
  eligible_items: number;
  eligible_albums: number;
  updated_at: string;
  last_error: string | null;
};

const toCoverageStatus = (covered: number, eligible: number): ExportCoverageStatus => {
  if (covered <= 0) return 'not_started';
  return eligible > 0 && covered >= eligible ? 'completed' : 'partial';
};

const emptySummary = (provider: ExportTargetType): ExportProviderSummary => ({
  provider,
  coverageStatus: 'not_started',
  eligibleItems: 0,
  coveredItems: 0,
  eligibleAlbums: provider === 'google-photos' ? 0 : null,
  coveredAlbums: provider === 'google-photos' ? 0 : null,
  completedJobs: 0,
  lastAttempt: null,
  completedDestinations: []
});

const getExecutionId = (input: {
  executionId?: string | null;
  groupingSessionId?: string | null;
  sourceRoot?: string | null;
}) => {
  if (input.executionId) return input.executionId;
  const db = getDb();
  const groupingRow = input.groupingSessionId
    ? db.prepare('SELECT id FROM execution_history WHERE grouping_session_id = ?').get(input.groupingSessionId) as { id: string } | undefined
    : undefined;
  if (groupingRow) return groupingRow.id;
  if (!input.sourceRoot) return null;

  const row = db
    .prepare(
      `SELECT id
       FROM execution_history
       WHERE output_root = ?
       ORDER BY datetime(updated_at) DESC
       LIMIT 1`
    )
    .get(input.sourceRoot) as { id: string } | undefined;
  return row?.id ?? null;
};

export const reconcileUnlinkedExportJobs = () => {
  runMigrations();
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT id, source_root, created_at
       FROM export_jobs
       WHERE execution_id IS NULL`
    )
    .all() as Array<{ id: string; source_root: string; created_at: string }>;
  let linked = 0;

  for (const job of jobs) {
    const execution = db
      .prepare(
        `SELECT id
         FROM execution_history
         WHERE output_root = ?
           AND datetime(COALESCE(finished_at, started_at)) <= datetime(?)
         ORDER BY datetime(COALESCE(finished_at, started_at)) DESC
         LIMIT 1`
      )
      .get(job.source_root, job.created_at) as { id: string } | undefined;

    if (!execution) continue;
    linked += Number(db.prepare('UPDATE export_jobs SET execution_id = ? WHERE id = ? AND execution_id IS NULL').run(execution.id, job.id).changes);
  }

  return linked;
};

const getCoveredItems = (jobIds: string[], provider: ExportTargetType) => {
  if (jobIds.length === 0) return 0;
  const placeholders = jobIds.map(() => '?').join(', ');
  const coveredStatuses = provider === 'network-folder' ? "('completed', 'skipped')" : "('completed')";
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT source_path) AS covered
       FROM export_items
       WHERE job_id IN (${placeholders}) AND status IN ${coveredStatuses}`
    )
    .get(...jobIds) as { covered: number };
  return row.covered;
};

const getCoveredAlbums = (jobIds: string[]) => {
  if (jobIds.length === 0) return 0;
  const placeholders = jobIds.map(() => '?').join(', ');
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS covered
       FROM (
         SELECT destination_path
         FROM export_items
         WHERE job_id IN (${placeholders})
           AND NOT (
             status = 'skipped'
             AND last_error = 'File type is not supported by Google Photos.'
           )
         GROUP BY destination_path
         HAVING COUNT(DISTINCT source_path) = COUNT(DISTINCT CASE WHEN status = 'completed' THEN source_path END)
       ) AS completed_albums`
    )
    .get(...jobIds) as { covered: number };
  return row.covered;
};

const getCompletedDestinations = (jobs: ExportSummaryJobRow[]): ExportDestinationSummary[] => {
  const destinations = new Map<string, ExportDestinationSummary>();

  for (const job of jobs) {
    if (job.status !== 'completed' || !job.destination_label) continue;
    const existing = destinations.get(job.destination_label);
    destinations.set(job.destination_label, {
      label: job.destination_label,
      completedJobs: (existing?.completedJobs ?? 0) + 1,
      lastCompletedAt:
        !existing || new Date(job.updated_at).getTime() > new Date(existing.lastCompletedAt).getTime()
          ? job.updated_at
          : existing.lastCompletedAt
    });
  }

  return [...destinations.values()].sort(
    (left, right) => new Date(right.lastCompletedAt).getTime() - new Date(left.lastCompletedAt).getTime()
  );
};

export const listExportProviderSummaries = (input: {
  executionId?: string | null;
  groupingSessionId?: string | null;
  sourceRoot?: string | null;
}): ExportProviderSummary[] => {
  runMigrations();
  reconcileUnlinkedExportJobs();
  const executionId = getExecutionId(input);
  if (!executionId) return PROVIDERS.map(emptySummary);

  const jobs = getDb()
    .prepare(
      `SELECT id, target_type, destination_label, status, eligible_items, eligible_albums, updated_at, last_error
       FROM export_jobs
       WHERE execution_id = ?
       ORDER BY datetime(updated_at) DESC`
    )
    .all(executionId) as ExportSummaryJobRow[];

  return PROVIDERS.map((provider) => {
    const providerJobs = jobs.filter((job) => job.target_type === provider);
    if (providerJobs.length === 0) return emptySummary(provider);

    const jobIds = providerJobs.map((job) => job.id);
    const coverageReferenceJobs = provider === 'google-photos'
      ? providerJobs.filter((job) => job.status === 'completed')
      : [];
    const eligibleReferenceJobs = coverageReferenceJobs.length > 0 ? coverageReferenceJobs : providerJobs;
    const coveredItems = getCoveredItems(jobIds, provider);
    const coveredAlbums = provider === 'google-photos' ? getCoveredAlbums(jobIds) : null;
    const eligibleItems = Math.max(...eligibleReferenceJobs.map((job) => job.eligible_items), coveredItems, 0);
    const eligibleAlbums = provider === 'google-photos'
      ? Math.max(...eligibleReferenceJobs.map((job) => job.eligible_albums), coveredAlbums ?? 0, 0)
      : null;
    const lastJob = providerJobs[0];

    return {
      provider,
      coverageStatus: toCoverageStatus(coveredItems, eligibleItems),
      eligibleItems,
      coveredItems,
      eligibleAlbums,
      coveredAlbums,
      completedJobs: providerJobs.filter((job) => job.status === 'completed').length,
      lastAttempt: {
        status: lastJob.status,
        updatedAt: lastJob.updated_at,
        error: lastJob.last_error
      },
      completedDestinations: getCompletedDestinations(providerJobs)
    };
  });
};
