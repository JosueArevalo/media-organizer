import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import {
  assertExportJobRequest, collectExportFilePlan, collectGooglePhotosFilePlan, getExportJob, normalizeNetworkDestinationPathForComparison,
  previewGooglePhotosExport, refreshExportJobCounters, resolveExecutionId,
  updateGooglePhotosExportJobScope
} from './exportJob.service.js';
import { assertNetworkExportRunnerAvailable, isGooglePhotosExportRunnerActive, ExportRunnerBusyError } from './exportJob.runner.js';
import { getGooglePhotosExportGroupId, getNetworkExportGroupId } from './exportGroupIds.js';
import { getVerifiedNetworkHistory, toExportItem, type NetworkItemRow } from './exportPlan.service.js';
import { getExportGroupProgress } from './exportProgress.service.js';
import { ExportScopeError, validateGroupIds } from './exportGroupIds.js';
export { ExportScopeError, validateGroupIds } from './exportGroupIds.js';
import type {
  ExportGroupPreview, ExportJobSnapshot,
  ExportPreview, ExportPreviewRequest, NetworkFolderTarget
} from './export.types.js';

export const previewExport = async (input: ExportPreviewRequest): Promise<ExportPreview> => {
  runMigrations();
  let job: ExportJobSnapshot | null = null;
  if (input.jobId) {
    job = getExportJob(input.jobId);
    if (!job) throw new ExportScopeError('Export job not found.');
    const target = JSON.parse(job.checkpoint?.payloadJson ?? '{}').target;
    const matches = job.job.sourceRoot === input.sourceRoot && job.job.targetType === input.target.type
      && (input.target.type === 'network-folder'
        ? normalizeNetworkDestinationPathForComparison(job.job.targetPath ?? '') === normalizeNetworkDestinationPathForComparison(input.target.destinationPath)
        : target?.accountId === input.target.accountId);
    const executionId = resolveExecutionId(input.groupingSessionId ?? undefined, input.sourceRoot);
    if (!matches || job.job.executionId !== executionId) throw new ExportScopeError('Export job does not belong to this context.');
  }
  if (input.jobOnly) {
    if (!job) throw new ExportScopeError('jobId is required to preview a persisted job.');
    return previewPersistedJob(job);
  }
  assertExportJobRequest({ sourceRoot: input.sourceRoot, target: input.target });
  if (input.target.type === 'google-photos') {
    const preview = await previewGooglePhotosExport(input.target.accountId, input.sourceRoot, input.groupingSessionId ?? undefined);
    const rows = job ? getDb().prepare(`SELECT i.*, m.phase, m.upload_token, m.media_item_id
      FROM export_items i LEFT JOIN export_google_photos_items m ON m.item_id = i.id
      WHERE i.job_id = ?`).all(job.job.id) as Array<NetworkItemRow & { phase: string; upload_token: string | null; media_item_id: string | null }> : [];
    const stateByPath = new Map(rows.map((row) => [row.relative_path, row]));
    return {
      groups: preview.albums.map((album) => ({
        id: getGooglePhotosExportGroupId(album.albumTitle), label: album.albumTitle,
        destinationStatus: album.status, exportStatus: album.uploadStatus,
        selectionLocked: rows.some((row) => row.destination_path === album.albumTitle
          && (row.status !== 'pending' || row.attempt_count > 0 || row.phase === 'uploaded' || row.phase === 'created'
            || row.upload_token !== null || row.media_item_id !== null)),
        itemCount: album.itemCount, items: album.items.map((item) => {
          const row = stateByPath.get(item.relativePath);
          return row && item.status !== 'completed' ? {
            ...item, id: row.id, jobId: row.job_id, status: row.status, lastError: row.last_error,
            updatedAt: row.updated_at, attemptCount: row.attempt_count
          } : item;
        })
      })),
      supportedItems: preview.supportedItems, unsupportedItems: preview.unsupportedItems
    };
  }
  const items = collectExportFilePlan(input.sourceRoot, input.target.destinationPath);
  const states = getVerifiedNetworkHistory(input.sourceRoot, input.target.destinationPath,
    resolveExecutionId(input.groupingSessionId ?? undefined, input.sourceRoot));
  // A restored job uses every persisted item, including rows outside the rolling progress window.
  if (job) {
    const rows = getDb().prepare('SELECT * FROM export_items WHERE job_id = ?').all(job.job.id) as NetworkItemRow[];
    for (const row of rows) {
      const item = toExportItem(row);
      const verified = states.get(item.sourcePath);
      if ((item.status === 'completed' || item.status === 'skipped') && verified?.status === 'pending') item.status = 'pending';
      states.set(item.sourcePath, item);
    }
  }
  const groups = new Map<string, ExportGroupPreview>();
  for (const item of items) {
    const id = getNetworkExportGroupId(item.relativePath);
    const group = groups.get(id) ?? {
      id, label: id === 'root:' ? '' : id.slice('folder:'.length), isRoot: id === 'root:',
      exportStatus: 'pending', itemCount: 0, items: []
    };
    const state = states.get(item.sourcePath);
    group.items.push({
      relativePath: item.relativePath, sizeBytes: item.sizeBytes, supported: true,
      id: state?.id, jobId: state?.jobId, status: state?.status ?? 'pending',
      lastError: state?.lastError, updatedAt: state?.updatedAt, attemptCount: state?.attemptCount
    });
    if (job && state?.jobId === job.job.id && (state.status !== 'pending' || state.attemptCount > 0)) group.selectionLocked = true;
    group.itemCount++;
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    group.exportStatus = group.items.every((item) => item.status === 'completed' || item.status === 'skipped') ? 'completed' : 'pending';
  }
  return { groups: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)), supportedItems: items.length, unsupportedItems: 0 };
};

const previewPersistedJob = (snapshot: ExportJobSnapshot): ExportPreview => {
  const rows = getDb().prepare('SELECT * FROM export_items WHERE job_id = ? ORDER BY relative_path').all(snapshot.job.id) as NetworkItemRow[];
  const groups = new Map<string, ExportGroupPreview>();
  for (const row of rows) {
    const photos = snapshot.job.targetType === 'google-photos';
    const id = photos ? getGooglePhotosExportGroupId(row.destination_path) : getNetworkExportGroupId(row.relative_path);
    const group = groups.get(id) ?? { id, label: photos ? row.destination_path : id === 'root:' ? '' : id.slice(7),
      isRoot: id === 'root:', exportStatus: 'pending', itemCount: 0, items: [] };
    group.items.push({ relativePath: row.relative_path, sizeBytes: row.size_bytes, supported: true,
      id: row.id, jobId: row.job_id, status: row.status, lastError: row.last_error,
      updatedAt: row.updated_at, attemptCount: row.attempt_count });
    group.itemCount++;
    groups.set(id, group);
  }
  for (const group of groups.values()) {
    group.exportStatus = group.items.every((item) => item.status === 'completed' || item.status === 'skipped') ? 'completed' : 'pending';
  }
  return { groups: [...groups.values()], supportedItems: rows.length, unsupportedItems: 0 };
};

export const updateExportJobScope = (jobId: string, groupIds: string[]) => {
  validateGroupIds(groupIds);
  const snapshot = getExportJob(jobId);
  if (!snapshot) return null;
  if (!['paused', 'draft'].includes(snapshot.job.status)) throw new ExportScopeError('Export scope can only change while paused or draft.');
  if (snapshot.job.targetType === 'google-photos') {
    if (isGooglePhotosExportRunnerActive(jobId)) throw new ExportRunnerBusyError('The export is still finishing its current item.');
    const available = new Set(collectGooglePhotosFilePlan(snapshot.job.sourceRoot).map((item) => getGooglePhotosExportGroupId(item.albumTitle)));
    for (const group of getExportGroupProgress(jobId)) available.add(group.groupId);
    if (groupIds.some((id) => !available.has(id))) throw new ExportScopeError('Unknown export group.');
    return updateGooglePhotosExportJobScope(jobId, groupIds.map((id) => id.slice('album:'.length)));
  }
  assertNetworkExportRunnerAvailable(jobId);
  const db = getDb();
  const target = JSON.parse(snapshot.checkpoint?.payloadJson ?? '{}').target as NetworkFolderTarget;
  const plan = collectExportFilePlan(snapshot.job.sourceRoot, snapshot.job.targetPath as string);
  const rows = db.prepare('SELECT * FROM export_items WHERE job_id = ?').all(jobId) as NetworkItemRow[];
  const available = new Set([...plan.map((item) => getNetworkExportGroupId(item.relativePath)), ...rows.map((item) => getNetworkExportGroupId(item.relative_path))]);
  if (groupIds.some((id) => !available.has(id))) throw new ExportScopeError('Unknown export group.');
  const protectedGroups = rows.filter((item) => item.status !== 'pending' || item.attempt_count > 0)
    .map((item) => getNetworkExportGroupId(item.relative_path));
  const effective = [...new Set([...groupIds, ...protectedGroups])];
  const history = getVerifiedNetworkHistory(snapshot.job.sourceRoot, snapshot.job.targetPath as string, snapshot.job.executionId);
  const selectedPlan = plan.filter((item) => effective.includes(getNetworkExportGroupId(item.relativePath)));
  const timestamp = new Date().toISOString();
  try {
    db.exec('BEGIN TRANSACTION');
    for (const item of rows) {
      if (item.status === 'pending' && item.attempt_count === 0 && !effective.includes(getNetworkExportGroupId(item.relative_path))) {
        db.prepare('DELETE FROM export_items WHERE id = ?').run(item.id);
      }
    }
    const existing = new Set(rows.filter((item) => effective.includes(getNetworkExportGroupId(item.relative_path))).map((item) => item.source_path));
    const insert = db.prepare(`INSERT INTO export_items
      (id,job_id,source_path,relative_path,destination_path,size_bytes,status,attempt_count,last_error,updated_at)
      VALUES (?,?,?,?,?,?,'pending',0,NULL,?)`);
    for (const item of selectedPlan) {
      const status = history.get(item.sourcePath)?.status;
      if (existing.has(item.sourcePath) || status === 'completed' || status === 'skipped') continue;
      insert.run(randomUUID(), jobId, item.sourcePath, item.relativePath, item.destinationPath, item.sizeBytes, timestamp);
    }
    const payload = JSON.parse(snapshot.checkpoint?.payloadJson ?? '{}');
    db.prepare('UPDATE export_checkpoints SET payload_json = ?, updated_at = ? WHERE job_id = ?')
      .run(JSON.stringify({ ...payload, target: { ...target, groupIds: effective } }), timestamp, jobId);
    db.prepare('UPDATE export_jobs SET eligible_items = ?, updated_at = ? WHERE id = ?').run(plan.length, timestamp, jobId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  refreshExportJobCounters(jobId, snapshot.job.status);
  // An empty editable job is still resumable after selecting more groups.
  db.prepare('UPDATE export_jobs SET status = ? WHERE id = ?').run(snapshot.job.status, jobId);
  return getExportJob(jobId);
};
