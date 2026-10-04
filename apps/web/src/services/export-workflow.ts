import type { ExportJobSnapshot, ExportPreview, ExportTarget } from './export.service';
import { normalizeNetworkPathForComparison } from './export.service';

export type ExportWorkflowAdapter = {
  target: ExportTarget;
  destinationLabel: string;
  defaultJobName: string;
  groupJobName?: (label: string) => string;
  prepare?: () => Promise<void>;
  allowPreviewRefresh?: boolean;
};

export const getExportDestinationKey = (target: ExportTarget) => target.type === 'google-photos'
  ? target.accountId : normalizeNetworkPathForComparison(target.destinationPath);

export const getExportJobTarget = (job: ExportJobSnapshot | null): ExportTarget | null => {
  try { return JSON.parse(job?.checkpoint?.payloadJson ?? '{}').target ?? null; }
  catch { return null; }
};

export const getExportJobGroupSelection = (preview: ExportPreview, job: ExportJobSnapshot | null) => {
  const target = getExportJobTarget(job);
  if (target?.type === 'google-photos' && Array.isArray(target.albumTitles)) {
    return new Set(target.albumTitles.map((title) => `album:${title}`));
  }
  if (target?.type === 'network-folder' && Array.isArray(target.groupIds)) return new Set(target.groupIds);
  // Legacy jobs did not persist an explicit scope; all groups remain selected.
  return new Set(preview.groups.filter((group) => group.exportStatus === 'pending').map((group) => group.id));
};

export const withExportGroupSelection = (target: ExportTarget, groupIds: string[]): ExportTarget => target.type === 'google-photos'
  ? { ...target, albumTitles: groupIds.map((id) => id.slice('album:'.length)) }
  : { ...target, groupIds };
