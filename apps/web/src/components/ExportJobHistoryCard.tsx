import { useState } from 'react';
import { useExportWorkflow } from '../hooks/useExportWorkflow';
import { useTranslation } from '../i18n';
import { ExportWorkflowPanel } from './ExportWorkflowPanel';
import type { ExportJobSnapshot } from '../services/export.service';
import type { ExportWorkflowAdapter } from '../services/export-workflow';

const JobDetails = ({ snapshot, groupingSessionId, adapter, blocked, onJobChange }: {
  snapshot: ExportJobSnapshot; groupingSessionId: string | null; adapter: ExportWorkflowAdapter;
  blocked: boolean; onJobChange: () => void;
}) => {
  const workflow = useExportWorkflow({ sourceRoot: snapshot.job.sourceRoot, groupingSessionId,
    adapter, fixedJobId: snapshot.job.id, onJobChange });
  return <ExportWorkflowPanel workflow={workflow} provider={snapshot.job.targetType} history blocked={blocked} />;
};

export const ExportJobHistoryCard = (props: {
  snapshot: ExportJobSnapshot; groupingSessionId: string | null; adapter: ExportWorkflowAdapter;
  blocked: boolean; onJobChange: () => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { job } = props.snapshot;
  const percent = job.totalItems ? Math.round(((job.completedItems + job.skippedItems) / job.totalItems) * 100) : 0;
  return <details className="settings-panel export-panel network-progress-card" open={open}
    onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <strong>{t('export.progressTitle')} ({job.targetPath ?? job.destinationLabel})</strong>
      <span className="page-summary-note">{t('export.progressSummary', {
        completed: job.completedItems, skipped: job.skippedItems, failed: job.failedItems, total: job.totalItems
      })} · {percent}%</span>
    </summary>
    {open && <JobDetails {...props} />}
  </details>;
};
