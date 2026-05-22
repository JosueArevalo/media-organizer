import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExportJobState } from '../hooks/useExportJobState';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import { saveExportJobSnapshot } from '../services/export-job.store';
import {
  createExportJobRequest,
  getExportProgressRequest,
  pauseExportJobRequest,
  retryFailedExportItemsRequest,
  startExportJobRequest,
  testExportTargetRequest,
  type ExportProgress,
  type ExportTargetTestResult
} from '../services/export.service';

const itemStatusLabels = {
  pending: 'export.itemStatus.pending',
  running: 'export.itemStatus.running',
  completed: 'export.itemStatus.completed',
  failed: 'export.itemStatus.failed',
  skipped: 'export.itemStatus.skipped'
} as const;

const formatBytes = (value: number) => {
  if (value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;

  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

export const NetworkFolderExportPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupingSessionState = useGroupingSessionState();
  const exportJobState = useExportJobState();
  const [destinationPath, setDestinationPath] = useState(exportJobState.destinationPath ?? '');
  const [targetTest, setTargetTest] = useState<ExportTargetTestResult | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const sourceRoot = groupingSessionState.outputRootLabel ?? '';
  const backendJobId = exportJobState.backendJobId;
  const canStart = Boolean(sourceRoot && destinationPath.trim() && targetTest?.ok && !isStarting);
  const isRunning = progress?.status === 'running' || exportJobState.status === 'running';
  const completeCount = (progress?.completed ?? 0) + (progress?.skipped ?? 0);
  const progressPercent = progress?.total ? Math.round((completeCount / progress.total) * 100) : 0;

  const syncSnapshot = useCallback(
    (nextProgress: ExportProgress) => {
      saveExportJobSnapshot({
        backendJobId: nextProgress.jobId,
        status: nextProgress.status,
        sourceRoot,
        destinationPath,
        startedAt: exportJobState.startedAt ?? Date.now(),
        completedAt: ['completed', 'failed', 'cancelled'].includes(nextProgress.status) ? Date.now() : null,
        errorMessage: nextProgress.failed > 0 ? t('export.completedWithErrors', { count: nextProgress.failed }) : null,
        updatedAt: Date.now()
      });
    },
    [destinationPath, exportJobState.startedAt, sourceRoot, t]
  );

  const refreshProgress = useCallback(async () => {
    if (!backendJobId) {
      return null;
    }

    const nextProgress = await getExportProgressRequest(backendJobId);
    setProgress(nextProgress);
    syncSnapshot(nextProgress);
    return nextProgress;
  }, [backendJobId, syncSnapshot]);

  useEffect(() => {
    if (!backendJobId) {
      return;
    }

    void refreshProgress().catch((error) => {
      setBackendError(error instanceof Error ? error.message : t('export.progressError'));
    });
  }, [backendJobId, refreshProgress, t]);

  useEffect(() => {
    if (!isRunning || !backendJobId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshProgress().catch((error) => {
        setBackendError(error instanceof Error ? error.message : t('export.progressError'));
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [backendJobId, isRunning, refreshProgress, t]);

  const recentItems = useMemo(() => progress?.recentItems ?? [], [progress]);

  const handleTestTarget = async () => {
    setIsTesting(true);

    try {
      const result = await testExportTargetRequest({ type: 'network-folder', destinationPath });
      setTargetTest(result);
      setBackendError(null);
    } catch (error) {
      setTargetTest(null);
      setBackendError(error instanceof Error ? error.message : t('export.testError'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleStart = async () => {
    if (!canStart) {
      return;
    }

    setIsStarting(true);

    try {
      const job = backendJobId
        ? await startExportJobRequest(backendJobId)
        : await createExportJobRequest({
            name: t('export.defaultJobName'),
            sourceRoot,
            target: { type: 'network-folder', destinationPath }
          });

      saveExportJobSnapshot({
        backendJobId: job.job.id,
        status: job.job.status,
        sourceRoot,
        destinationPath,
        startedAt: Date.now(),
        completedAt: null,
        errorMessage: null,
        updatedAt: Date.now()
      });

      if (!backendJobId) {
        await startExportJobRequest(job.job.id);
      }

      const nextProgress = await getExportProgressRequest(job.job.id);
      setProgress(nextProgress);
      syncSnapshot(nextProgress);
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.startError'));
    } finally {
      setIsStarting(false);
    }
  };

  const handlePause = async () => {
    if (!backendJobId) return;

    try {
      const job = await pauseExportJobRequest(backendJobId);
      saveExportJobSnapshot({
        backendJobId,
        status: job.job.status,
        sourceRoot,
        destinationPath,
        startedAt: exportJobState.startedAt,
        completedAt: null,
        errorMessage: null,
        updatedAt: Date.now()
      });
      await refreshProgress();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.pauseError'));
    }
  };

  const handleRetryFailed = async () => {
    if (!backendJobId) return;

    try {
      const job = await retryFailedExportItemsRequest(backendJobId);
      saveExportJobSnapshot({
        backendJobId,
        status: job.job.status,
        sourceRoot,
        destinationPath,
        startedAt: exportJobState.startedAt ?? Date.now(),
        completedAt: null,
        errorMessage: null,
        updatedAt: Date.now()
      });
      await refreshProgress();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.retryError'));
    }
  };

  return (
    <div className="page-stack export-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">{t('export.network.title')}</h2>
          <p className="page-subtitle">{t('export.network.subtitle')}</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => navigate('/export')}>
          {t('export.backToProviders')}
        </button>
      </div>

      {!sourceRoot && <p className="error">{t('export.unavailable')}</p>}
      {backendError && <p className="error">{backendError}</p>}

      <section className="settings-panel export-panel">
        <div>
          <p className="page-section-title">{t('export.sourceTitle')}</p>
          <p className="page-summary-note">{sourceRoot || t('export.noSource')}</p>
        </div>

        <label className="folder-path-control">
          <span>{t('export.destinationLabel')}</span>
          <input
            className="folder-path-input"
            value={destinationPath}
            onChange={(event) => {
              setDestinationPath(event.target.value);
              setTargetTest(null);
            }}
            placeholder="\\\\192.168.0.148\\photos\\2026"
            type="text"
          />
        </label>

        <div className="export-actions">
          <button className="btn btn-secondary" type="button" onClick={() => void handleTestTarget()} disabled={!destinationPath.trim() || isTesting}>
            {isTesting ? t('export.testing') : t('export.testTarget')}
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void handleStart()} disabled={!canStart}>
            {isStarting ? t('export.starting') : t('export.start')}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => void handlePause()} disabled={!backendJobId || !isRunning}>
            {t('export.pause')}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => void handleRetryFailed()} disabled={!backendJobId || !progress?.failed}>
            {t('export.retryFailed')}
          </button>
        </div>

        {targetTest && (
          <p className={targetTest.ok ? 'success-message' : 'error'}>
            {targetTest.message}
          </p>
        )}
      </section>

      <section className="settings-panel export-panel">
        <div className="grouping-main-head">
          <div>
            <p className="page-section-title">{t('export.progressTitle')}</p>
            <p className="page-summary-note">
              {progress ? t('export.progressSummary', {
                completed: progress.completed,
                skipped: progress.skipped,
                failed: progress.failed,
                total: progress.total
              }) : t('export.noJob')}
            </p>
          </div>
          <strong>{progressPercent}%</strong>
        </div>

        <div className="progress-track" aria-label={t('export.progressAria')}>
          <div className="export-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="export-stats">
          <div>
            <strong>{progress?.total ?? 0}</strong>
            <span>{t('export.total')}</span>
          </div>
          <div>
            <strong>{progress?.completed ?? 0}</strong>
            <span>{t('export.completed')}</span>
          </div>
          <div>
            <strong>{progress?.skipped ?? 0}</strong>
            <span>{t('export.skipped')}</span>
          </div>
          <div>
            <strong>{progress?.failed ?? 0}</strong>
            <span>{t('export.failed')}</span>
          </div>
        </div>

        {recentItems.length > 0 && (
          <div className="export-item-list">
            {recentItems.map((item) => (
              <div key={item.id} className="export-item-row">
                <div>
                  <strong title={item.relativePath}>{item.relativePath}</strong>
                  <span>{formatBytes(item.sizeBytes)}</span>
                </div>
                <span className={`status-pill status-${item.status}`}>{t(itemStatusLabels[item.status])}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default NetworkFolderExportPage;
