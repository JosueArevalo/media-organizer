import { getDb } from '../../state/db.js';
import { getGooglePhotosExportGroupId, getNetworkExportGroupId } from './exportGroupIds.js';
import type { NetworkItemRow } from './exportPlan.service.js';
import type { ExportGroupProgress, ExportTargetType } from './export.types.js';

export const getExportGroupProgress = (jobId: string): ExportGroupProgress[] => {
  const job = getDb().prepare('SELECT target_type FROM export_jobs WHERE id = ?').get(jobId) as { target_type: ExportTargetType } | undefined;
  if (!job) return [];
  const rows = getDb().prepare('SELECT relative_path, destination_path, status FROM export_items WHERE job_id = ?').all(jobId) as NetworkItemRow[];
  const groups = new Map<string, ExportGroupProgress & { running: number }>();
  for (const item of rows) {
    const groupId = job.target_type === 'google-photos'
      ? getGooglePhotosExportGroupId(item.destination_path) : getNetworkExportGroupId(item.relative_path);
    const group = groups.get(groupId) ?? { groupId, total: 0, completed: 0, failed: 0, skipped: 0, pending: 0, running: 0, status: 'pending' };
    group.total++;
    group[item.status]++;
    groups.set(groupId, group);
  }
  return [...groups.values()].map(({ running, ...group }) => ({ ...group,
    pending: group.pending + running,
    status: group.failed > 0 ? 'failed' : running > 0 ? 'running' : group.skipped === group.total ? 'skipped'
      : group.completed + group.skipped === group.total ? 'completed' : 'pending'
  }));
};

