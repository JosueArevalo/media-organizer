import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExportJobState } from '../hooks/useExportJobState';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import { saveExportJobSnapshot } from '../services/export-job.store';
import {
  authenticateNetworkPathRequest,
  browseNetworkPathRequest,
  createNetworkFolderRequest,
  createExportJobRequest,
  deleteNetworkDestinationRequest,
  getExportProgressRequest,
  isValidUncPath,
  listNetworkDestinationsRequest,
  pauseExportJobRequest,
  retryFailedExportItemsRequest,
  saveNetworkDestinationRequest,
  startExportJobRequest,
  testExportTargetRequest,
  type NetworkBrowseResult,
  type NetworkCredentials,
  type NetworkDestination,
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
  const [destinations, setDestinations] = useState<NetworkDestination[]>([]);
  const [selectedDestinationId, setSelectedDestinationId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveRootPath, setSaveRootPath] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberInWindows, setRememberInWindows] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSavingDestination, setIsSavingDestination] = useState(false);
  const [isDeletingDestination, setIsDeletingDestination] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isManualPathOpen, setIsManualPathOpen] = useState(false);
  const [browserResult, setBrowserResult] = useState<NetworkBrowseResult | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

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
  const selectedDestination = useMemo(
    () => destinations.find((destination) => destination.id === selectedDestinationId) ?? null,
    [destinations, selectedDestinationId]
  );
  const shouldShowAddLocation = destinations.length === 0 || isAddLocationOpen;
  const hasSelectedDestination = Boolean(selectedDestination);
  const selectedRootPath = selectedDestination?.rootPath ?? '';
  const canBrowseNetworkFolder = Boolean(selectedRootPath || destinationPath.trim());

  const credentials = useMemo<NetworkCredentials | undefined>(() => {
    if (!username.trim() || !password) {
      return undefined;
    }

    return {
      username: username.trim(),
      password,
      rememberInWindows
    };
  }, [password, rememberInWindows, username]);

  const resetNetworkDestinationDraft = useCallback(() => {
    setSelectedDestinationId('');
    setSaveName('');
    setSaveRootPath('');
    setDestinationPath('');
    setUsername('');
    setPassword('');
    setRememberInWindows(false);
    setAuthMessage(null);
    setAuthError(null);
    setTargetTest(null);
    setBrowserResult(null);
    setBrowserError(null);
    setNewFolderName('');
    setIsBrowserOpen(false);
    setIsManualPathOpen(false);
    setIsAddLocationOpen(true);
  }, []);

  const loadDestinations = useCallback(async () => {
    try {
      const result = await listNetworkDestinationsRequest();
      setDestinations(result.destinations);

      if (result.destinations.length === 0) {
        resetNetworkDestinationDraft();
        return;
      }

      setIsAddLocationOpen(false);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.network.destinationsLoadError'));
    }
  }, [resetNetworkDestinationDraft, t]);

  useEffect(() => {
    void loadDestinations();
  }, [loadDestinations]);

  const handleSelectDestination = (destinationId: string) => {
    setSelectedDestinationId(destinationId);
    const destination = destinations.find((item) => item.id === destinationId);

    if (!destination) {
      resetNetworkDestinationDraft();
      return;
    }

    setSaveName(destination.name);
    setSaveRootPath(destination.rootPath);
    setDestinationPath(destination.rootPath);
    setUsername(destination.username ?? '');
    setPassword('');
    setRememberInWindows(false);
    setTargetTest(null);
    setAuthMessage(null);
    setAuthError(null);
    setBrowserResult(null);
    setBrowserError(null);
    setNewFolderName('');
    setIsBrowserOpen(false);
    setIsManualPathOpen(false);
  };

  const handleToggleAddLocation = () => {
    setIsAddLocationOpen((current) => {
      const nextIsOpen = !current;

      if (nextIsOpen) {
        setSaveName('');
        setSaveRootPath('');
      }

      return nextIsOpen;
    });
  };

  const handleSaveDestination = async () => {
    const rootPath = saveRootPath.trim();

    if (!rootPath) {
      setBackendError(t('export.network.saveRootRequired'));
      return;
    }

    if (!isValidUncPath(rootPath)) {
      setBackendError(t('export.network.invalidUncPath'));
      setIsAddLocationOpen(true);
      return;
    }

    setIsSavingDestination(true);

    try {
      const saved = await saveNetworkDestinationRequest({
        name: saveName.trim() || undefined,
        rootPath,
        username: username.trim() || undefined
      });
      await loadDestinations();
      setSelectedDestinationId(saved.id);
      setSaveName(saved.name);
      setSaveRootPath(saved.rootPath);
      setDestinationPath(saved.rootPath);
      setTargetTest(null);
      setBackendError(null);
      setIsAddLocationOpen(false);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.network.saveError'));
      setIsAddLocationOpen(true);
    } finally {
      setIsSavingDestination(false);
    }
  };

  const handleSaveDestinationSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSaveDestination();
  };

  const handleDeleteDestination = async () => {
    if (!selectedDestination) {
      return;
    }

    setIsDeletingDestination(true);

    try {
      await deleteNetworkDestinationRequest(selectedDestination.id);
      await loadDestinations();
      resetNetworkDestinationDraft();
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.network.deleteError'));
    } finally {
      setIsDeletingDestination(false);
    }
  };

  const handleAuthenticate = async () => {
    if (!credentials) {
      setAuthError(t('export.network.credentialsRequired'));
      return;
    }

    setIsAuthenticating(true);

    try {
      const result = await authenticateNetworkPathRequest({ path: destinationPath.trim() || selectedRootPath, credentials });
      setAuthMessage(result.message);
      setAuthError(null);
      setBackendError(null);
    } catch (error) {
      setAuthMessage(null);
      setAuthError(error instanceof Error ? error.message : t('export.network.authError'));
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleAuthenticateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleAuthenticate();
  };

  const openBrowser = async () => {
    const rootPath = selectedRootPath || destinationPath.trim();

    if (!rootPath) {
      setBrowserError(t('export.network.browserRootRequired'));
      setIsBrowserOpen(true);
      return;
    }

    setIsBrowserOpen(true);
    await loadBrowserPath(rootPath, rootPath);
  };

  const loadBrowserPath = async (pathToBrowse: string, rootPath = selectedRootPath || pathToBrowse) => {
    setIsBrowsing(true);

    try {
      const result = await browseNetworkPathRequest({
        path: pathToBrowse,
        rootPath,
        credentials
      });
      setBrowserResult(result);
      setBrowserError(null);
    } catch (error) {
      setBrowserResult(null);
      setBrowserError(error instanceof Error ? error.message : t('export.network.browserError'));
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleCreateRemoteFolder = async () => {
    if (!browserResult || !newFolderName.trim()) {
      return;
    }

    setIsBrowsing(true);

    try {
      const rootPath = selectedRootPath || browserResult.path;
      await createNetworkFolderRequest({
        parentPath: browserResult.path,
        folderName: newFolderName.trim(),
        rootPath,
        credentials
      });
      setNewFolderName('');
      await loadBrowserPath(browserResult.path, rootPath);
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : t('export.network.createFolderError'));
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleTestTarget = async () => {
    setIsTesting(true);

    try {
      const result = await testExportTargetRequest({ type: 'network-folder', destinationPath }, credentials);
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
      if (credentials) {
        await authenticateNetworkPathRequest({ path: destinationPath, credentials });
      }

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
      <div className="page-header export-page-header">
        <div>
          <h2 className="page-title">{t('export.network.title')}</h2>
          <p className="page-subtitle">{t('export.network.subtitle')}</p>
        </div>
        <button className="btn btn-secondary export-back-button" type="button" onClick={() => navigate('/export')}>
          {t('export.backToProviders')}
        </button>
      </div>

      {!sourceRoot && <p className="error">{t('export.unavailable')}</p>}
      {backendError && <p className="error">{backendError}</p>}

      <section className="settings-panel export-panel network-export-flow">
        <div className="network-step network-source-step">
          <p className="page-section-title">{t('export.sourceTitle')}</p>
          <p className="page-summary-note">{sourceRoot || t('export.noSource')}</p>
        </div>

        <div className="network-step">
          <div className="network-section-header">
            <div>
              <p className="page-section-title">{t('export.network.locationStep')}</p>
              <p className="page-summary-note">{t('export.network.savedDestinationsNote')}</p>
            </div>
            <div className="network-header-actions">
              {destinations.length > 0 && (
                <button className="btn btn-secondary" type="button" onClick={handleToggleAddLocation}>
                  {isAddLocationOpen ? t('export.network.hideAddLocation') : t('export.network.addAnotherLocation')}
                </button>
              )}
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => void handleDeleteDestination()}
                disabled={!selectedDestination || isDeletingDestination}
              >
                {isDeletingDestination ? t('export.network.deletingDestination') : t('export.network.deleteDestination')}
              </button>
            </div>
          </div>

          {destinations.length === 0 ? (
            <p className="network-empty-note">{t('export.network.noSavedDestinationNote')}</p>
          ) : (
            <div className="network-location-list" aria-label={t('export.network.savedDestinations')}>
              {destinations.map((destination) => (
                <button
                  key={destination.id}
                  className={`network-location-card${destination.id === selectedDestinationId ? ' is-selected' : ''}`}
                  type="button"
                  onClick={() => handleSelectDestination(destination.id)}
                >
                  <strong>{destination.name}</strong>
                  <span>{destination.rootPath}</span>
                </button>
              ))}
            </div>
          )}

          {shouldShowAddLocation && <form className="network-subsection" onSubmit={handleSaveDestinationSubmit}>
            <div>
              <p className="network-subsection-title">{t('export.network.addLocationTitle')}</p>
              <p className="page-summary-note">{t('export.network.addLocationNote')}</p>
            </div>

            <div className="network-destination-grid">
              <label className="folder-path-control">
                <span>{t('export.network.saveName')}</span>
                <input
                  className="folder-path-input"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder={t('export.network.saveNamePlaceholder')}
                  type="text"
                />
              </label>

              <label className="folder-path-control">
                <span>{t('export.network.rootPath')}</span>
                <input
                  className="folder-path-input"
                  value={saveRootPath}
                  onChange={(event) => setSaveRootPath(event.target.value)}
                  placeholder={t('export.network.rootPathPlaceholder')}
                  type="text"
                />
                <small className="field-hint">{t('export.network.rootPathHint')}</small>
              </label>
            </div>

            <div className="network-export-tools">
              <button className="btn btn-primary" type="submit" disabled={isSavingDestination}>
                {isSavingDestination ? t('export.network.savingDestination') : t('export.network.saveDestination')}
              </button>
            </div>
          </form>}
        </div>

        {hasSelectedDestination && <form className="network-step" onSubmit={handleAuthenticateSubmit}>
          <div>
            <p className="page-section-title">{t('export.network.accessStep')}</p>
            <p className="page-summary-note">{t('export.network.credentialsNote')}</p>
          </div>
          <div className="network-auth-grid">
            <label className="folder-path-control">
              <span>{t('export.network.username')}</span>
              <input
                className="folder-path-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="NAS\\user or user"
                type="text"
                autoComplete="username"
              />
            </label>
            <label className="folder-path-control">
              <span>{t('export.network.password')}</span>
              <input
                className="folder-path-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
          </div>
          <div className="network-auth-footer">
            <label className="network-checkbox">
              <input
                checked={rememberInWindows}
                onChange={(event) => setRememberInWindows(event.target.checked)}
                type="checkbox"
              />
              <span>{t('export.network.rememberInWindows')}</span>
            </label>
            <button className="btn btn-secondary" type="submit" disabled={isAuthenticating || !username.trim() || !password}>
              {isAuthenticating ? t('export.network.authenticating') : t('export.network.authenticate')}
            </button>
          </div>
          {authMessage && <p className="success-message">{authMessage}</p>}
          {authError && <p className="error">{authError}</p>}
        </form>}

        {hasSelectedDestination && <div className="network-step network-export-folder">
          <div>
            <p className="page-section-title">{t('export.network.folderStep')}</p>
            <p className="page-summary-note">{t('export.network.exportFolderNote')}</p>
          </div>

          <div className="network-path-summary">
            <span>{destinationPath.trim() || t('export.network.noExportFolder')}</span>
          </div>

          <div className="network-export-tools">
            <button className="btn btn-primary" type="button" onClick={() => void openBrowser()} disabled={!canBrowseNetworkFolder}>
              {t('export.network.chooseFolder')}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setIsManualPathOpen((current) => !current)}>
              {isManualPathOpen ? t('export.network.hideManualPath') : t('export.network.editPathManually')}
            </button>
          </div>

          {isManualPathOpen && (
            <label className="folder-path-control">
              <span>{t('export.destinationLabel')}</span>
              <input
                className="folder-path-input"
                value={destinationPath}
                onChange={(event) => {
                  setDestinationPath(event.target.value);
                  setTargetTest(null);
                }}
                placeholder={t('export.network.destinationPathPlaceholder')}
                type="text"
              />
            </label>
          )}
        </div>}

        {hasSelectedDestination && <div className="export-actions network-final-actions">
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
        </div>}

        {targetTest && (
          <div className={targetTest.ok ? 'success-message' : 'error'}>
            <p>{targetTest.message}</p>
            {targetTest.details && <small>{targetTest.details}</small>}
          </div>
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

      {isBrowserOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="network-browser-modal" role="dialog" aria-modal="true" aria-label={t('export.network.browserTitle')}>
            <div className="grouping-main-head">
              <div>
                <p className="page-section-title">{t('export.network.browserTitle')}</p>
                <p className="page-summary-note">{browserResult?.path ?? saveRootPath}</p>
              </div>
              <button className="btn btn-secondary" type="button" onClick={() => setIsBrowserOpen(false)}>
                {t('grouping.close')}
              </button>
            </div>

            {browserError && <p className="error">{browserError}</p>}

            <div className="network-browser-actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => browserResult?.parentPath && void loadBrowserPath(browserResult.parentPath)}
                disabled={!browserResult?.parentPath || isBrowsing}
              >
                {t('export.network.goUp')}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  if (!browserResult) return;
                  setDestinationPath(browserResult.path);
                  setIsBrowserOpen(false);
                  setTargetTest(null);
                }}
                disabled={!browserResult}
              >
                {t('export.network.chooseCurrentFolder')}
              </button>
            </div>

            {browserResult?.canCreateFolder && (
              <div className="network-browser-create">
                <input
                  className="folder-path-input"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder={t('export.network.newFolderPlaceholder')}
                  type="text"
                />
                <button className="btn btn-secondary" type="button" onClick={() => void handleCreateRemoteFolder()} disabled={!newFolderName.trim() || isBrowsing}>
                  {t('export.network.createFolder')}
                </button>
              </div>
            )}

            <div className="network-browser-list">
              {isBrowsing && <p className="page-summary-note">{t('export.network.loadingFolders')}</p>}
              {!isBrowsing && browserResult?.entries.length === 0 && <p className="page-summary-note">{t('export.network.noFolders')}</p>}
              {!isBrowsing && browserResult?.entries.map((entry) => (
                <button
                  key={entry.path}
                  className="network-browser-row"
                  type="button"
                  onClick={() => void loadBrowserPath(entry.path)}
                >
                  <span>{entry.kind === 'share' ? t('export.network.share') : t('export.network.folder')}</span>
                  <strong>{entry.name}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkFolderExportPage;
