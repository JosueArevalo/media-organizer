import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useExportJobState } from '../hooks/useExportJobState';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation, type TranslationKey } from '../i18n';
import { loadEncoderSettings } from '../services/encoder-settings.store';
import {
  deleteDashboardExecution,
  getBackendHealth,
  getDashboardExecutions,
  getDashboardSummary,
  type BackendHealth,
  type DashboardExecution,
  type DashboardSummary,
  type ExecutionStatus,
  type ExecutionVerification
} from '../services/dashboard.service';

const formatDateTime = (value: string | null) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const formatDuration = (start: string, end: string | null) => {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return '-';
  }

  const minutes = Math.max(1, Math.round((endMs - startMs) / 60000));
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
};

const basename = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() ?? value;

const STATUS_LABEL_KEYS: Record<ExecutionStatus, TranslationKey> = {
  running: 'dashboard.status.running',
  completed: 'dashboard.status.completed',
  failed: 'dashboard.status.failed',
  cancelled: 'dashboard.status.cancelled'
};

const VERIFICATION_STATUS_LABEL_KEYS: Record<ExecutionVerification['status'], TranslationKey> = {
  ok: 'verification.status.ok',
  mismatch: 'verification.status.mismatch',
  not_verified: 'verification.status.not_verified'
};

const statusClassName = (status: ExecutionStatus) => `dashboard-status dashboard-status-${status}`;

const getExecutionTitle = (execution: DashboardExecution) => execution.name || basename(execution.sourceDir) || execution.sessionId;

const hasRealVerification = (verification: ExecutionVerification | null | undefined) =>
  Boolean(verification?.verifiedAt && verification.expected.total > 0);

const VerificationSummary = ({ verification }: { verification: ExecutionVerification }) => {
  const { t } = useTranslation();

  return (
    <div className={`verification-panel verification-panel-${verification.status}`}>
      <div className="verification-head">
        <div>
          <p className="page-section-title">{t('verification.title')}</p>
          <p className="page-summary-note">
            {verification.status === 'ok'
              ? t('verification.okDescription')
              : verification.status === 'mismatch'
                ? t('verification.mismatchDescription')
                : t('verification.notVerifiedDescription')}
          </p>
        </div>
        <span className={`verification-status verification-status-${verification.status}`}>
          {t(VERIFICATION_STATUS_LABEL_KEYS[verification.status])}
        </span>
      </div>
      <div className="verification-grid">
        <div>
          <strong>{t('verification.expected')}</strong>
          <span>{t('verification.counts', {
            total: verification.expected.total,
            images: verification.expected.images,
            videos: verification.expected.videos,
            unknown: verification.expected.unknown
          })}</span>
        </div>
        <div>
          <strong>{t('verification.destination')}</strong>
          <span>{t('verification.counts', {
            total: verification.destination.total,
            images: verification.destination.images,
            videos: verification.destination.videos,
            unknown: verification.destination.unknown
          })}</span>
        </div>
        <div>
          <strong>{t('verification.verifiedAt')}</strong>
          <span>{formatDateTime(verification.verifiedAt)}</span>
        </div>
      </div>
    </div>
  );
};

export const DashboardPage = () => {
  const { t } = useTranslation();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const compressionSessionState = useCompressionSessionState();
  const groupingSessionState = useGroupingSessionState();
  const exportJobState = useExportJobState();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [executions, setExecutions] = useState<DashboardExecution[]>([]);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [hasConfiguredEncoders, setHasConfiguredEncoders] = useState(true);

  const refreshDashboard = async () => {
    const [nextSummary, nextExecutions] = await Promise.all([
      getDashboardSummary(),
      getDashboardExecutions()
    ]);
    setSummary(nextSummary);
    setExecutions(nextExecutions);
  };

  useEffect(() => {
    let isActive = true;

    refreshDashboard()
      .then(() => {
        if (!isActive) return;
        setDashboardError(null);
      })
      .catch((error) => {
        if (!isActive) return;
        setDashboardError(error instanceof Error ? error.message : t('dashboard.loadError'));
      });

    getBackendHealth()
      .then((data) => {
        if (!isActive) return;
        setHealth(data);
        setHealthError(null);
      })
      .catch((error) => {
        if (!isActive) return;
        setHealthError(error instanceof Error ? error.message : t('dashboard.healthUnknown'));
      });

    loadEncoderSettings().then((settings) => {
      if (!isActive) return;
      setHasConfiguredEncoders(Boolean(settings.imageToolCommand.trim() && settings.videoToolCommand.trim()));
    });

    return () => {
      isActive = false;
    };
  }, [t]);

  const currentState = (() => {
    if (exportJobState.status === 'running' || exportJobState.status === 'paused') {
      return {
        title: t('dashboard.workflow.exportRunningTitle'),
        description: t('dashboard.workflow.exportRunningDescription'),
        action: { to: '/export/network-folder', label: t('dashboard.action.openExport') }
      };
    }

    if (exportJobState.status === 'failed') {
      return {
        title: t('dashboard.workflow.exportFailedTitle'),
        description: exportJobState.errorMessage ?? t('dashboard.workflow.exportFailedDescription'),
        action: { to: '/export/network-folder', label: t('dashboard.action.openExport') }
      };
    }

    if (exportJobState.status === 'completed') {
      return {
        title: t('dashboard.workflow.exportCompletedTitle'),
        description: t('dashboard.workflow.exportCompletedDescription'),
        action: { to: '/export/network-folder', label: t('dashboard.action.openExport') }
      };
    }

    if (groupingSessionState.status === 'completed') {
      return {
        title: t('dashboard.workflow.groupingCompletedTitle'),
        description: t('dashboard.workflow.groupingCompletedDescription', {
          destination: groupingSessionState.outputRootLabel ?? destinationSelection?.path ?? '-'
        }),
        action: { to: '/export', label: t('dashboard.action.openExport') }
      };
    }

    if (groupingSessionState.status === 'running' || groupingSessionState.status === 'paused') {
      return {
        title: t('dashboard.workflow.groupingRunningTitle'),
        description: t('dashboard.workflow.groupingRunningDescription'),
        action: { to: '/grouping', label: t('dashboard.action.openGrouping') }
      };
    }

    if (groupingSessionState.status === 'failed') {
      return {
        title: t('dashboard.workflow.groupingFailedTitle'),
        description: groupingSessionState.errorMessage ?? t('dashboard.workflow.groupingFailedDescription'),
        action: { to: '/grouping', label: t('dashboard.action.openGrouping') }
      };
    }

    if (compressionSessionState.status === 'running') {
      return {
        title: t('dashboard.workflow.compressionRunningTitle'),
        description: t('dashboard.workflow.compressionRunningDescription'),
        action: { to: '/compression', label: t('dashboard.action.openProgress') }
      };
    }

    if (compressionSessionState.status === 'completed') {
      return {
        title: t('dashboard.workflow.compressionCompletedTitle'),
        description: t('dashboard.workflow.compressionCompletedDescription'),
        action: { to: '/grouping', label: t('dashboard.action.openGrouping') }
      };
    }

    if (compressionSessionState.status === 'failed') {
      return {
        title: t('dashboard.workflow.compressionFailedTitle'),
        description: compressionSessionState.errorMessage ?? t('dashboard.workflow.compressionFailedDescription'),
        action: { to: '/compression', label: t('dashboard.action.openProgress') }
      };
    }

    if (!sourceSelection || !destinationSelection) {
      return {
        title: t('dashboard.workflow.chooseFoldersTitle'),
        description: t('dashboard.workflow.chooseFoldersDescription'),
        action: { to: '/import', label: t('dashboard.action.chooseFolders') }
      };
    }

    if (!hasConfiguredEncoders) {
      return {
        title: t('dashboard.workflow.configureToolsTitle'),
        description: t('dashboard.workflow.configureToolsDescription'),
        action: { to: '/settings', label: t('dashboard.action.configureTools') }
      };
    }

    return {
      title: t('dashboard.workflow.readyTitle'),
      description: t('dashboard.workflow.readyDescription'),
      action: { to: '/selection', label: t('dashboard.action.reviewSelection') }
    };
  })();

  const localAlerts = useMemo(() => {
    const alerts: Array<{ id: string; level: 'info' | 'warning' | 'error'; message: string }> = [];

    if (healthError) {
      alerts.push({
        id: 'backend-offline',
        level: 'error',
        message: t('dashboard.alert.backendOffline')
      });
    }

    if (!hasConfiguredEncoders && sourceSelection && destinationSelection && compressionSessionState.status === 'idle') {
      alerts.push({
        id: 'encoders-missing',
        level: 'warning',
        message: t('dashboard.alert.encodersMissing')
      });
    }

    if (compressionSessionState.status === 'failed' && compressionSessionState.errorMessage) {
      alerts.push({
        id: 'compression-failed',
        level: 'error',
        message: compressionSessionState.errorMessage
      });
    }

    if (groupingSessionState.status === 'failed' && groupingSessionState.errorMessage) {
      alerts.push({
        id: 'grouping-failed',
        level: 'error',
        message: groupingSessionState.errorMessage
      });
    }

    if (exportJobState.status === 'failed' && exportJobState.errorMessage) {
      alerts.push({
        id: 'export-failed',
        level: 'error',
        message: exportJobState.errorMessage
      });
    }

    return alerts;
  }, [
    compressionSessionState.errorMessage,
    compressionSessionState.status,
    destinationSelection,
    exportJobState.errorMessage,
    exportJobState.status,
    groupingSessionState.errorMessage,
    groupingSessionState.status,
    hasConfiguredEncoders,
    healthError,
    sourceSelection,
    t
  ]);

  const highlightedVerification = summary?.lastExecution?.groupingStatus === 'completed' && hasRealVerification(summary.lastExecution.verification)
    ? summary.lastExecution.verification
    : null;

  const handleDeleteExecution = async (executionId: string) => {
    const confirmed = window.confirm(t('dashboard.deleteConfirm'));
    if (!confirmed) {
      return;
    }

    setIsDeletingId(executionId);
    try {
      await deleteDashboardExecution(executionId);
      await refreshDashboard();
      if (expandedExecutionId === executionId) {
        setExpandedExecutionId(null);
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : t('dashboard.deleteError'));
    } finally {
      setIsDeletingId(null);
    }
  };

  return (
    <div className="dashboard-grid dashboard-real">
      <section className="panel panel-highlight dashboard-hero">
        <div>
          <p className="panel-kicker">{t('dashboard.status')}</p>
          <h2 className="panel-title">{currentState.title}</h2>
          <p className="panel-description">{currentState.description}</p>
        </div>
        <div className="action-row">
          <Link to={currentState.action.to} className="btn btn-primary">
            {currentState.action.label}
          </Link>
        </div>
      </section>

      {dashboardError && <p className="error">{dashboardError}</p>}

      {highlightedVerification && <VerificationSummary verification={highlightedVerification} />}

      {localAlerts.length > 0 && (
        <section className="panel dashboard-alerts">
          <p className="panel-kicker">{t('dashboard.attention')}</p>
          <div className="dashboard-alert-list">
            {localAlerts.map((alert) => (
              <p key={alert.id} className={`dashboard-alert dashboard-alert-${alert.level}`}>
                {alert.message}
              </p>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-row">
          <div>
            <p className="panel-kicker">{t('dashboard.executionHistory')}</p>
            <h3 className="panel-title small">{t('dashboard.executionHistoryTitle')}</h3>
          </div>
        </div>

        {executions.length === 0 ? (
          <p className="empty-note">{t('dashboard.noExecutions')}</p>
        ) : (
          <ul className="job-list dashboard-execution-list">
            {executions.map((execution) => {
              const isExpanded = expandedExecutionId === execution.id;
              return (
                <li key={execution.id} className="job-item dashboard-execution-item">
                  <button
                    className="dashboard-execution-main"
                    type="button"
                    onClick={() => setExpandedExecutionId(isExpanded ? null : execution.id)}
                  >
                    <span className="dashboard-execution-copy">
                      <span className="job-title">{getExecutionTitle(execution)}</span>
                      <span className="job-meta">
                        {formatDateTime(execution.finishedAt ?? execution.updatedAt)} - {execution.totalItems} {t('dashboard.files')}
                      </span>
                    </span>
                    <span className="dashboard-execution-side">
                      <span className={statusClassName(execution.status)}>{t(STATUS_LABEL_KEYS[execution.status])}</span>
                      <span className="job-meta">{execution.completedItems} / {execution.totalItems}</span>
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="dashboard-execution-details">
                      <div className="dashboard-detail-grid">
                        <p><strong>{t('dashboard.started')}</strong><br />{formatDateTime(execution.startedAt)}</p>
                        <p><strong>{t('dashboard.finished')}</strong><br />{formatDateTime(execution.finishedAt)}</p>
                        <p><strong>{t('dashboard.duration')}</strong><br />{formatDuration(execution.startedAt, execution.finishedAt)}</p>
                        <p><strong>{t('dashboard.media')}</strong><br />{execution.imageItems} {t('dashboard.photos')} / {execution.videoItems} {t('dashboard.videos')}</p>
                        <p><strong>{t('dashboard.source')}</strong><br />{execution.sourceDir}</p>
                        <p><strong>{t('dashboard.destination')}</strong><br />{execution.outputRoot ?? execution.outputDir}</p>
                        <p><strong>{t('dashboard.presets')}</strong><br />{execution.imageProfileLabel ?? '-'} / {execution.videoPresetLabel ?? '-'}</p>
                        <p><strong>{t('dashboard.grouping')}</strong><br />{execution.groupingStatus ? `${t(STATUS_LABEL_KEYS[execution.groupingStatus])} (${execution.groupingCompletedItems}/${execution.groupingTotalItems})` : t('dashboard.groupingNone')}</p>
                      </div>
                      {hasRealVerification(execution.verification) && <VerificationSummary verification={execution.verification} />}
                      {execution.errorSummary.length > 0 && (
                        <div className="dashboard-error-summary">
                          <strong>{t('dashboard.errors')}</strong>
                          {execution.errorSummary.slice(0, 5).map((item) => (
                            <p key={`${item.source}:${item.error ?? ''}`}>{basename(item.source)}: {item.error ?? t('dashboard.unknownError')}</p>
                          ))}
                        </div>
                      )}
                      <button
                        className="btn btn-danger-secondary"
                        type="button"
                        onClick={() => void handleDeleteExecution(execution.id)}
                        disabled={isDeletingId === execution.id}
                      >
                        {isDeletingId === execution.id ? t('dashboard.deleting') : t('dashboard.deleteExecution')}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel dashboard-health-panel">
        <div>
          <p className="panel-kicker">{t('dashboard.backendSignal')}</p>
          <h3 className="panel-title small">{healthError ? t('dashboard.backendOffline') : t('dashboard.backendOnline')}</h3>
        </div>
        {healthError ? (
          <p className="error">{t('dashboard.backendError', { message: healthError })}</p>
        ) : health ? (
          <div className="health-grid">
            <p><strong>{t('dashboard.service')}</strong><br />{health.service}</p>
            <p><strong>{t('dashboard.healthStatus')}</strong><br />{health.status}</p>
            <p><strong>{t('dashboard.time')}</strong><br />{formatDateTime(health.time)}</p>
            <p><strong>{t('dashboard.migrations')}</strong><br />{health.appliedMigrations.length > 0 ? health.appliedMigrations.join(', ') : t('dashboard.noMigrations')}</p>
          </div>
        ) : (
          <p className="muted">{t('dashboard.checkingHealth')}</p>
        )}
      </section>
    </div>
  );
};

export default DashboardPage;
