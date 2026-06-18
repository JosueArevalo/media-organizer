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
  isValidNetworkPath,
  listExportJobsRequest,
  listNetworkDestinationsRequest,
  normalizeNetworkPathForComparison,
  pauseExportJobRequest,
  retryFailedExportItemsRequest,
  saveNetworkDestinationRequest,
  startExportJobRequest,
  testExportTargetRequest,
  type NetworkBrowseResult,
  type NetworkCredentials,
  type NetworkDestination,
  type ExportJobSnapshot,
  type ExportTargetTestResult
} from '../services/export.service';
import { pickDirectoryRequest } from '../services/system-picker.service';
import { getRuntimePlatform, isWindowsPlatform } from '../services/tool-status.service';

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
  const runtimePlatform = getRuntimePlatform();
  const isWindows = isWindowsPlatform(runtimePlatform);
  const groupingSessionState = useGroupingSessionState();
  const exportJobState = useExportJobState('network-folder', {
    groupingSessionId: groupingSessionState.backendSessionId,
    sourceRoot: groupingSessionState.outputRootLabel
  });
  const [destinationPath, setDestinationPath] = useState(exportJobState.destinationPath ?? '');
  const [targetTest, setTargetTest] = useState<ExportTargetTestResult | null>(null);
  const [jobs, setJobs] = useState<ExportJobSnapshot[]>([]);
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
  const [isPickingMountedFolder, setIsPickingMountedFolder] = useState(false);
  const [isDeletingDestination, setIsDeletingDestination] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [isManualPathOpen, setIsManualPathOpen] = useState(false);
  const [browserResult, setBrowserResult] = useState<NetworkBrowseResult | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const sourceRoot = groupingSessionState.outputRootLabel ?? '';
  const normalizedDestinationPath = normalizeNetworkPathForComparison(destinationPath, runtimePlatform);
  const matchingJob = jobs.find((snapshot) =>
    snapshot.job.targetPath
    && normalizeNetworkPathForComparison(snapshot.job.targetPath, runtimePlatform) === normalizedDestinationPath
  ) ?? null;
  const runningJob = jobs.find((snapshot) => snapshot.job.status === 'running') ?? null;
  const canResumeMatchingJob = matchingJob?.job.status === 'paused' || matchingJob?.job.status === 'draft';
  const canStart = Boolean(
    sourceRoot
    && destinationPath.trim()
    && !isStarting
    && !runningJob
    && (canResumeMatchingJob || (!matchingJob && targetTest?.ok))
  );

  const syncSnapshot = useCallback(
    (snapshot: ExportJobSnapshot) => {
      const completedAt = ['completed', 'failed', 'cancelled'].includes(snapshot.job.status)
        ? exportJobState.backendJobId === snapshot.job.id && exportJobState.completedAt
          ? exportJobState.completedAt
          : Date.now()
        : null;

      saveExportJobSnapshot({
        backendJobId: snapshot.job.id,
        status: snapshot.job.status,
        sourceRoot,
        groupingSessionId: groupingSessionState.backendSessionId,
        destinationPath: snapshot.job.targetPath,
        googlePhotosAccountId: null,
        targetType: 'network-folder',
        totalItems: snapshot.job.totalItems,
        startedAt: exportJobState.backendJobId === snapshot.job.id ? exportJobState.startedAt ?? Date.now() : Date.now(),
        completedAt,
        errorMessage: snapshot.job.failedItems > 0 ? t('export.completedWithErrors', { count: snapshot.job.failedItems }) : null,
        updatedAt: Date.now()
      });
    },
    [exportJobState.backendJobId, exportJobState.completedAt, exportJobState.startedAt, groupingSessionState.backendSessionId, sourceRoot, t]
  );

  const refreshJobs = useCallback(async () => {
    if (!sourceRoot) {
      setJobs([]);
      return [];
    }

    const nextJobs = await listExportJobsRequest({
      targetType: 'network-folder',
      groupingSessionId: groupingSessionState.backendSessionId,
      sourceRoot
    });
    setJobs(nextJobs);
    const newestJob = nextJobs[0];
    const currentJob = nextJobs.find((snapshot) => snapshot.job.id === exportJobState.backendJobId);
    const snapshotCandidate = nextJobs.find((snapshot) => snapshot.job.status === 'running') ?? currentJob ?? newestJob;
    if (
      snapshotCandidate
      && (
        exportJobState.backendJobId !== snapshotCandidate.job.id
        || exportJobState.status !== snapshotCandidate.job.status
        || exportJobState.destinationPath !== snapshotCandidate.job.targetPath
      )
    ) {
      syncSnapshot(snapshotCandidate);
    }
    return nextJobs;
  }, [
    exportJobState.backendJobId,
    exportJobState.destinationPath,
    exportJobState.status,
    groupingSessionState.backendSessionId,
    sourceRoot,
    syncSnapshot
  ]);

  useEffect(() => {
    void refreshJobs().catch((error) => {
      setBackendError(error instanceof Error ? error.message : t('export.progressError'));
    });
  }, [refreshJobs, t]);

  useEffect(() => {
    if (!runningJob) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshJobs().catch((error) => {
        setBackendError(error instanceof Error ? error.message : t('export.progressError'));
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [refreshJobs, runningJob, t]);
  const selectedDestination = useMemo(
    () => destinations.find((destination) => destination.id === selectedDestinationId) ?? null,
    [destinations, selectedDestinationId]
  );
  const shouldShowAddLocation = destinations.length === 0 || isAddLocationOpen;
  const hasSelectedDestination = Boolean(selectedDestination);
  const selectedRootPath = selectedDestination?.rootPath ?? '';
  const canBrowseNetworkFolder = Boolean(selectedRootPath || destinationPath.trim());

  const credentials = useMemo<NetworkCredentials | undefined>(() => {
    if (!isWindows || !username.trim() || !password) {
      return undefined;
    }

    return {
      username: username.trim(),
      password,
      rememberInWindows
    };
  }, [isWindows, password, rememberInWindows, username]);

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

    if (!isValidNetworkPath(rootPath, runtimePlatform)) {
      setBackendError(isWindows ? t('export.network.invalidUncPath') : t('export.network.invalidMountedPath'));
      setIsAddLocationOpen(true);
      return;
    }

    setIsSavingDestination(true);

    try {
      const saved = await saveNetworkDestinationRequest({
        name: saveName.trim() || undefined,
        rootPath,
        username: isWindows ? username.trim() || undefined : undefined
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

  const handlePickMountedFolder = async () => {
    setIsPickingMountedFolder(true);

    try {
      const result = await pickDirectoryRequest({
        title: t('export.network.mountedFolderPickerTitle'),
        initialPath: saveRootPath
      });

      if (result.status === 'selected') {
        setSaveRootPath(result.path);
        setDestinationPath(result.path);
        setTargetTest(null);
        setBackendError(null);
      } else if (result.status === 'unsupported') {
        setBackendError(result.message);
      }
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.network.mountedFolderPickerError'));
    } finally {
      setIsPickingMountedFolder(false);
    }
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

      const job = canResumeMatchingJob && matchingJob
        ? await startExportJobRequest(matchingJob.job.id)
        : await createExportJobRequest({
            name: t('export.defaultJobName'),
            sourceRoot,
            groupingSessionId: groupingSessionState.backendSessionId ?? undefined,
            target: { type: 'network-folder', destinationPath }
          });

      syncSnapshot(job);

      if (!canResumeMatchingJob) {
        await startExportJobRequest(job.job.id);
      }

      await refreshJobs();
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.startError'));
    } finally {
      setIsStarting(false);
    }
  };

  const handlePause = async (jobId: string) => {
    const snapshot = jobs.find((job) => job.job.id === jobId);
    if (!snapshot) return;

    try {
      const job = await pauseExportJobRequest(jobId);
      syncSnapshot(job);
      await refreshJobs();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.pauseError'));
    }
  };

  const handleResume = async (jobId: string) => {
    try {
      const job = await startExportJobRequest(jobId);
      syncSnapshot(job);
      await refreshJobs();
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.startError'));
    }
  };

  const handleRetryFailed = async (jobId: string) => {
    const snapshot = jobs.find((job) => job.job.id === jobId);
    if (!snapshot) return;

    try {
      const job = await retryFailedExportItemsRequest(jobId);
      syncSnapshot(job);
      await refreshJobs();
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
              <p className="page-summary-note">
                {isWindows
                  ? t('export.network.addLocationNote')
                  : runtimePlatform === 'darwin'
                    ? t('export.network.mountedLocationNoteMac')
                    : t('export.network.mountedLocationNoteLinux')}
              </p>
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
                <span>{isWindows ? t('export.network.rootPath') : t('export.network.mountedRootPath')}</span>
                <input
                  className="folder-path-input"
                  value={saveRootPath}
                  onChange={(event) => setSaveRootPath(event.target.value)}
                  placeholder={isWindows
                    ? t('export.network.rootPathPlaceholder')
                    : runtimePlatform === 'darwin'
                      ? t('export.network.mountedRootPathPlaceholderMac')
                      : t('export.network.mountedRootPathPlaceholderLinux')}
                  type="text"
                />
                <small className="field-hint">
                  {isWindows
                    ? t('export.network.rootPathHint')
                    : runtimePlatform === 'darwin'
                      ? t('export.network.mountedRootPathHintMac')
                      : t('export.network.mountedRootPathHintLinux')}
                </small>
              </label>
            </div>

            <div className="network-export-tools">
              {!isWindows && (
                <button className="btn btn-secondary" type="button" onClick={() => void handlePickMountedFolder()} disabled={isPickingMountedFolder}>
                  {isPickingMountedFolder ? t('export.network.selectingMountedFolder') : t('export.network.selectMountedFolder')}
                </button>
              )}
              <button className="btn btn-primary" type="submit" disabled={isSavingDestination}>
                {isSavingDestination ? t('export.network.savingDestination') : t('export.network.saveDestination')}
              </button>
            </div>
          </form>}
        </div>

        {hasSelectedDestination && isWindows && <form className="network-step" onSubmit={handleAuthenticateSubmit}>
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
            <p className="page-section-title">{isWindows ? t('export.network.folderStep') : t('export.network.folderStepUnix')}</p>
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
                placeholder={isWindows
                  ? t('export.network.destinationPathPlaceholder')
                  : runtimePlatform === 'darwin'
                    ? t('export.network.mountedRootPathPlaceholderMac')
                    : t('export.network.mountedRootPathPlaceholderLinux')}
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
            {isStarting ? t('export.starting') : canResumeMatchingJob ? t('export.resume') : t('export.start')}
          </button>
        </div>}

        {targetTest && (
          <div className={targetTest.ok ? 'success-message' : 'error'}>
            <p>{targetTest.message}</p>
            {targetTest.details && <small>{targetTest.details}</small>}
          </div>
        )}
      </section>

      <div className="network-progress-list">
        {jobs.length === 0 && (
          <section className="settings-panel export-panel">
            <p className="page-section-title">{t('export.progressTitle')}</p>
            <p className="page-summary-note">{t('export.noJob')}</p>
          </section>
        )}

        {jobs.map((snapshot) => {
          const job = snapshot.job;
          const completeCount = job.completedItems + job.skippedItems;
          const progressPercent = job.totalItems ? Math.round((completeCount / job.totalItems) * 100) : 0;
          const anotherJobIsRunning = Boolean(runningJob && runningJob.job.id !== job.id);

          return (
            <section className="settings-panel export-panel network-progress-card" key={job.id}>
              <div className="grouping-main-head">
                <div>
                  <p className="page-section-title">
                    {t('export.progressTitle')} ({job.targetPath})
                  </p>
                  <p className="page-summary-note">
                    {t('export.progressSummary', {
                      completed: job.completedItems,
                      skipped: job.skippedItems,
                      failed: job.failedItems,
                      total: job.totalItems
                    })}
                  </p>
                </div>
                <strong>{progressPercent}%</strong>
              </div>

              <div className="progress-track" aria-label={`${t('export.progressAria')} (${job.targetPath})`}>
                <div className="export-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>

              <div className="export-stats">
                <div>
                  <strong>{job.totalItems}</strong>
                  <span>{t('export.total')}</span>
                </div>
                <div>
                  <strong>{job.completedItems}</strong>
                  <span>{t('export.completed')}</span>
                </div>
                <div>
                  <strong>{job.skippedItems}</strong>
                  <span>{t('export.skipped')}</span>
                </div>
                <div>
                  <strong>{job.failedItems}</strong>
                  <span>{t('export.failed')}</span>
                </div>
              </div>

              <div className="export-actions">
                {job.status === 'running' && (
                  <button className="btn btn-secondary" type="button" onClick={() => void handlePause(job.id)}>
                    {t('export.pause')}
                  </button>
                )}
                {(job.status === 'paused' || job.status === 'draft') && (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void handleResume(job.id)}
                    disabled={anotherJobIsRunning}
                  >
                    {t('export.resume')}
                  </button>
                )}
                {job.status === 'failed' && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => void handleRetryFailed(job.id)}
                    disabled={anotherJobIsRunning}
                  >
                    {t('export.retryFailed')}
                  </button>
                )}
              </div>

              {snapshot.recentItems.length > 0 && (
                <div className="export-item-list">
                  {snapshot.recentItems.map((item) => (
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
          );
        })}
      </div>

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
