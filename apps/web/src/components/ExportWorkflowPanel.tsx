import type { ExportWorkflow } from '../hooks/useExportWorkflow';
import { useTranslation } from '../i18n';
import type { ExportTargetType } from '../services/export.service';

const itemStatusLabels = {
  pending: 'export.itemStatus.pending', running: 'export.itemStatus.running', paused: 'export.itemStatus.paused',
  completed: 'export.itemStatus.completed', failed: 'export.itemStatus.failed', skipped: 'export.itemStatus.skipped'
} as const;

const formatBytes = (value: number) => {
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;
  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const shortError = (error: string) => {
  const index = error.indexOf('. Album:');
  return index > 0 ? error.slice(0, index + 1) : error;
};

export const ExportWorkflowPanel = ({ workflow, provider, history = false, blocked = false }: {
  workflow: ExportWorkflow; provider: ExportTargetType; history?: boolean; blocked?: boolean;
}) => {
  const { t } = useTranslation();
  const photos = provider === 'google-photos';
  const completedLabel = t(photos ? 'export.googlePhotos.albumUploaded' : 'export.workflow.groupCompleted');
  const groups = history && !workflow.isPaused
    ? workflow.groups.filter((group) => workflow.progress?.groupProgress?.some((progress) => progress.groupId === group.id))
    : workflow.groups;
  const failedCount = groups.reduce((sum, group) => sum + group.failedCount, 0);
  return (
    <div className="export-workflow" aria-busy={workflow.isRestoring || workflow.isPreviewing}>
      {workflow.error && <p className="error" role="alert">{workflow.error}</p>}
      <div className="export-actions">
        {!history && <button className="btn btn-secondary" type="button" onClick={() => void workflow.handlePreview()} disabled={!workflow.canPreview || blocked}>
          {workflow.isPreviewing ? t(photos ? 'export.googlePhotos.previewing' : 'export.workflow.previewing') : t(photos ? 'export.googlePhotos.preview' : 'export.workflow.preview')}
        </button>}
        {(!history || workflow.isPaused) && <button className="btn btn-primary export-group-export-action" type="button"
          onClick={() => void workflow.handleStart()} disabled={!workflow.canStart || blocked}>
          {workflow.isStarting ? t('export.starting') : workflow.isPaused ? t('export.resume') : t(photos ? 'export.googlePhotos.uploadSelectedAlbums' : 'export.workflow.exportSelectedGroups')}
        </button>}
        <button className="btn btn-secondary" type="button" onClick={() => void workflow.handlePause()} disabled={!workflow.isRunning || workflow.isStarting}>
          {t('export.pause')}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => void workflow.handleRetryFailed()}
          disabled={!workflow.backendJobId || workflow.isRunning || workflow.isWaitingForRunner || workflow.isStarting || workflow.isUpdatingScope || !workflow.isScopeConfirmed || failedCount === 0 || blocked}>
          {t('export.retryFailed')}
        </button>
      </div>
      {workflow.preview && !history && <p className={`export-group-selection-summary${workflow.selectedPendingCount === 0 ? ' is-empty' : ''}`}>
        {t(photos ? 'export.googlePhotos.albumSelectionSummary' : 'export.workflow.selectionSummary', {
          selected: workflow.selectedPendingCount, excluded: workflow.excludedPendingCount
        })}
      </p>}
      {(workflow.isRestoring || workflow.isPreviewing) && !workflow.preview && (
        <div className="export-preview-loading" role="status" aria-live="polite">
          <strong>{t(photos ? 'export.googlePhotos.previewLoadingTitle' : 'export.workflow.previewLoadingTitle')}</strong>
          <p>{t(photos ? 'export.googlePhotos.previewLoadingBody' : 'export.workflow.previewLoadingBody')}</p>
        </div>
      )}
      {workflow.preview?.groups.length === 0 && <p className="page-summary-note">{t('export.workflow.empty')}</p>}
      <div className="export-group-list">
        {groups.map((group) => {
          const label = group.isRoot ? t('export.workflow.rootFiles') : group.label;
          const isOpen = workflow.expandedGroupIds.has(group.id);
          const isSelected = workflow.selectedGroupIds.has(group.id);
          const checked = group.isComplete || isSelected;
          const result = group.derivedStatus === 'skipped' && photos ? t('export.googlePhotos.albumSkipped')
            : group.isComplete ? completedLabel : group.derivedStatus === 'failed'
            ? t(photos ? 'export.googlePhotos.albumFailed' : 'export.workflow.groupFailed')
            : group.derivedStatus === 'running' ? t(photos ? 'export.googlePhotos.albumUploading' : 'export.workflow.groupExporting')
            : group.derivedStatus === 'paused' || workflow.isPaused ? t('export.itemStatus.paused') : null;
          return (
            <article className="export-group-panel" key={group.id} aria-label={label}>
              <div className="export-group-header">
                <label className={`export-group-select${!checked ? ' is-excluded' : ''}`}>
                  <input type="checkbox" checked={checked} aria-label={label}
                    onChange={() => workflow.toggleSelection(group.id)} disabled={!workflow.selectable(group.id) || blocked || (history && !workflow.isPaused)} />
                  <span>{group.isComplete ? completedLabel : isSelected
                    ? t(photos ? 'export.googlePhotos.albumSelected' : 'export.workflow.groupSelected')
                    : t(photos ? 'export.googlePhotos.albumExcluded' : 'export.workflow.groupExcluded')}</span>
                </label>
                <button className="export-group-toggle" type="button" onClick={() => workflow.toggleExpanded(group.id)} aria-expanded={isOpen}>
                  <span className={`export-accordion-chevron${isOpen ? ' is-open' : ''}`}>›</span>
                  <span><strong title={label}>{label}</strong><small>{t(photos ? 'export.googlePhotos.albumItemCount' : 'export.workflow.groupItemCount', { count: group.itemCount })}</small></span>
                </button>
                <div className="export-group-actions">
                  {group.destinationStatus && <span className={`status-pill status-${group.destinationStatus === 'existing' ? 'completed' : 'pending'}`}>
                    {t(group.destinationStatus === 'existing' ? 'export.googlePhotos.albumExisting' : 'export.googlePhotos.albumNew')}
                  </span>}
                  {result && <span className={`status-pill status-${group.derivedStatus}`}>{result}</span>}
                  {!history && <button className="btn btn-primary btn-compact export-group-export-action" type="button"
                    onClick={() => void workflow.handleStart(group.id)}
                    disabled={!workflow.canStart || workflow.isRunning || workflow.isPaused || group.isComplete || !isSelected || blocked}>
                    {group.isComplete ? completedLabel : t(photos ? 'export.googlePhotos.uploadAlbum' : 'export.workflow.exportGroup')}
                  </button>}
                </div>
              </div>
              {isOpen && <div className="export-group-body">
                <div className="progress-track" aria-label={t('export.progressAria')}>
                  <div className="export-progress-fill" style={{ width: `${group.progressPercent}%` }} />
                </div>
                <div className="export-stats">
                  <div><strong>{group.totalCount}</strong><span>{t('export.total')}</span></div>
                  <div><strong>{group.completedCount}</strong><span>{t('export.completed')}</span></div>
                  <div><strong>{group.skippedCount}</strong><span>{t('export.skipped')}</span></div>
                  <div><strong>{group.failedCount}</strong><span>{t('export.failed')}</span></div>
                </div>
                {group.failureSummary && <p className="export-group-error-summary">{group.failureSummary}</p>}
                <div className="export-item-list">
                  {group.items.map((item) => <div key={item.relativePath} className="export-item-row">
                    <div>
                      <strong title={item.relativePath}>{item.relativePath}</strong><span>{formatBytes(item.sizeBytes)}</span>
                      {item.status === 'failed' && item.lastError && <details className="export-item-error">
                        <summary>{shortError(item.lastError)}</summary><span>{item.lastError}</span>
                      </details>}
                    </div>
                    <div className="export-item-row-actions">
                      {item.status === 'failed' && item.id && <button className="btn btn-secondary btn-compact" type="button"
                        onClick={() => void workflow.handleRetryItem(item.id!, item.jobId)}
                        disabled={workflow.isRunning || workflow.isWaitingForRunner || workflow.isStarting || workflow.isUpdatingScope || !workflow.isScopeConfirmed || blocked}>
                        {workflow.retryingItemId === item.id ? t('export.retrying') : t('export.retryItem')}
                      </button>}
                      <span className={`status-pill status-${item.status}`}>{t(itemStatusLabels[item.status])}</span>
                    </div>
                  </div>)}
                </div>
              </div>}
            </article>
          );
        })}
      </div>
    </div>
  );
};
