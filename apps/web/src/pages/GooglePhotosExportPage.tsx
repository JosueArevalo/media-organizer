import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExportProviderIcon } from '../components/ExportProviderIcon';
import { useExportJobState } from '../hooks/useExportJobState';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import { resetExportJobSnapshot, saveExportJobSnapshot } from '../services/export-job.store';
import {
  createExportJobRequest,
  deleteGooglePhotosOAuthConfigRequest,
  deleteGooglePhotosAccountRequest,
  getExportProgressRequest,
  getGooglePhotosOAuthConfigRequest,
  listGooglePhotosAccountsRequest,
  pauseExportJobRequest,
  previewGooglePhotosExportRequest,
  retryFailedExportItemsRequest,
  saveGooglePhotosOAuthConfigRequest,
  startExportJobRequest,
  startGooglePhotosOAuthRequest,
  testExportTargetRequest,
  type ExportProgress,
  type GooglePhotosAccount,
  type GooglePhotosExportPreview,
  type GooglePhotosOAuthConfigStatus
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

const googlePhotosSetupLinks = {
  project: 'https://console.cloud.google.com/projectselector2/home/dashboard',
  photosApi: 'https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com',
  authOverview: 'https://console.cloud.google.com/auth/overview',
  authAudience: 'https://console.cloud.google.com/auth/audience',
  authClients: 'https://console.cloud.google.com/auth/clients',
  credentials: 'https://console.cloud.google.com/apis/credentials'
} as const;

type GooglePhotosAccordionSection = 'config' | 'account' | 'albums' | 'progress';

const createOpenSectionSet = (section: GooglePhotosAccordionSection) => new Set<GooglePhotosAccordionSection>([section]);

export const GooglePhotosExportPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupingSessionState = useGroupingSessionState();
  const exportJobState = useExportJobState();
  const [accounts, setAccounts] = useState<GooglePhotosAccount[]>([]);
  const [oauthConfig, setOauthConfig] = useState<GooglePhotosOAuthConfigStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [preview, setPreview] = useState<GooglePhotosExportPreview | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isClearingConfig, setIsClearingConfig] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isSetupGuideExpanded, setIsSetupGuideExpanded] = useState(false);
  const [isGoogleSignInPendingRefresh, setIsGoogleSignInPendingRefresh] = useState(false);
  const [openSections, setOpenSections] = useState<Set<GooglePhotosAccordionSection>>(() => createOpenSectionSet('config'));
  const [isAccordionManual, setIsAccordionManual] = useState(false);

  const sourceRoot = groupingSessionState.outputRootLabel ?? '';
  const backendJobId = exportJobState.backendJobId;
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const isPaused = progress?.status === 'paused' || exportJobState.status === 'paused';
  const isRunning = progress?.status === 'running' || exportJobState.status === 'running';
  const completeCount = (progress?.completed ?? 0) + (progress?.skipped ?? 0);
  const progressPercent = progress?.total ? Math.round((completeCount / progress.total) * 100) : 0;
  const canStart = Boolean(sourceRoot && selectedAccountId && !isStarting && (preview || isPaused));
  const canConnect = Boolean(oauthConfig?.configured && !isConnecting);
  const shouldShowConnectAccount = Boolean(oauthConfig?.configured && (!isGoogleSignInPendingRefresh || accounts.length > 0));
  const recentItems = useMemo(() => progress?.recentItems ?? [], [progress]);
  const shouldFocusProgress = Boolean(
    progress?.status && ['running', 'paused', 'completed'].includes(progress.status)
      || exportJobState.status === 'running'
      || exportJobState.status === 'paused'
      || exportJobState.status === 'completed'
  );
  const recommendedOpenSection = useMemo<GooglePhotosAccordionSection>(() => {
    if (shouldFocusProgress) return 'progress';
    if (!oauthConfig?.configured) return 'config';
    if (accounts.length === 0) return 'account';
    if (!preview) return 'albums';
    return 'albums';
  }, [accounts.length, oauthConfig?.configured, preview, shouldFocusProgress]);
  const setupSteps = useMemo(
    () => [
      {
        title: t('export.googlePhotos.setupProjectTitle'),
        description: t('export.googlePhotos.setupProject'),
        primaryHref: googlePhotosSetupLinks.project,
        primaryLabel: t('export.googlePhotos.openProjectSelector')
      },
      {
        title: t('export.googlePhotos.setupEnableApiTitle'),
        description: t('export.googlePhotos.setupEnableApi'),
        primaryHref: googlePhotosSetupLinks.photosApi,
        primaryLabel: t('export.googlePhotos.openPhotosApi')
      },
      {
        title: t('export.googlePhotos.setupConsentTitle'),
        description: t('export.googlePhotos.setupConsent'),
        primaryHref: googlePhotosSetupLinks.authAudience,
        primaryLabel: t('export.googlePhotos.openAudience'),
        secondaryHref: googlePhotosSetupLinks.authOverview,
        secondaryLabel: t('export.googlePhotos.openAuthPlatform')
      },
      {
        title: t('export.googlePhotos.setupClientTitle'),
        description: t('export.googlePhotos.setupClient'),
        primaryHref: googlePhotosSetupLinks.authClients,
        primaryLabel: t('export.googlePhotos.openOAuthClients'),
        secondaryHref: googlePhotosSetupLinks.credentials,
        secondaryLabel: t('export.googlePhotos.openCredentials')
      },
      {
        title: t('export.googlePhotos.setupCopyValuesTitle'),
        description: t('export.googlePhotos.setupCopyValues'),
        primaryHref: googlePhotosSetupLinks.authClients,
        primaryLabel: t('export.googlePhotos.openOAuthClients')
      }
    ],
    [t]
  );

  const syncSnapshot = useCallback(
    (nextProgress: ExportProgress) => {
      saveExportJobSnapshot({
        backendJobId: nextProgress.jobId,
        status: nextProgress.status,
        sourceRoot,
        destinationPath: selectedAccount?.email ?? null,
        startedAt: exportJobState.startedAt ?? Date.now(),
        completedAt: ['completed', 'failed', 'cancelled'].includes(nextProgress.status) ? Date.now() : null,
        errorMessage: nextProgress.failed > 0 ? t('export.completedWithErrors', { count: nextProgress.failed }) : null,
        updatedAt: Date.now()
      });
    },
    [exportJobState.startedAt, selectedAccount?.email, sourceRoot, t]
  );

  const resetGooglePhotosExportState = useCallback((message?: string | null) => {
    setPreview(null);
    setProgress(null);
    setBackendError(null);
    setStatusMessage(message ?? null);
    setIsGoogleSignInPendingRefresh(false);
    resetExportJobSnapshot();
  }, []);

  const isSectionOpen = useCallback((section: GooglePhotosAccordionSection) => openSections.has(section), [openSections]);

  const openOnlySection = useCallback((section: GooglePhotosAccordionSection) => {
    setIsAccordionManual(false);
    setOpenSections(createOpenSectionSet(section));
  }, []);

  const openSectionsManually = useCallback((sections: GooglePhotosAccordionSection[]) => {
    setIsAccordionManual(true);
    setOpenSections(new Set(sections));
  }, []);

  const toggleSection = useCallback((section: GooglePhotosAccordionSection) => {
    setIsAccordionManual(true);
    setOpenSections((current) => {
      const next = new Set(current);

      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }

      return next;
    });
  }, []);

  useEffect(() => {
    if (!isAccordionManual) {
      setOpenSections(createOpenSectionSet(recommendedOpenSection));
    }
  }, [isAccordionManual, recommendedOpenSection]);

  const loadAccounts = useCallback(async (autoSelect = true, keepAccountSectionOpen = false) => {
    setIsLoadingAccounts(true);

    try {
      const result = await listGooglePhotosAccountsRequest();
      setAccounts(result.accounts);
      if (result.accounts.length > 0) {
        setIsGoogleSignInPendingRefresh(false);
        if (keepAccountSectionOpen) {
          openSectionsManually(['account', 'albums']);
        }
      }
      setSelectedAccountId((current) => {
        if (!autoSelect) {
          return '';
        }

        return result.accounts.some((account) => account.id === current) ? current : result.accounts[0]?.id || '';
      });
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.accountsLoadError'));
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [openSectionsManually, t]);

  const loadOAuthConfig = useCallback(async () => {
    try {
      const result = await getGooglePhotosOAuthConfigRequest();
      setOauthConfig(result);
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.configLoadError'));
    }
  }, [t]);

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
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadOAuthConfig();
  }, [loadOAuthConfig]);

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

  useEffect(() => {
    setPreview(null);
  }, [selectedAccountId, sourceRoot]);

  const handleConnect = async () => {
    if (!oauthConfig?.configured) {
      setBackendError(t('export.googlePhotos.configRequired'));
      return;
    }

    setIsConnecting(true);

    try {
      await openGoogleSignIn();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('export.googlePhotos.oauthStartError');
      setBackendError(message.includes('redirect_uri_mismatch') ? t('export.googlePhotos.redirectMismatchError') : message);
    } finally {
      setIsConnecting(false);
    }
  };

  const openGoogleSignIn = async () => {
    const result = await startGooglePhotosOAuthRequest();
    window.open(result.authUrl, '_blank', 'noopener,noreferrer');
    setIsGoogleSignInPendingRefresh(true);
    setStatusMessage(t('export.googlePhotos.oauthOpened'));
    setBackendError(null);
  };

  const handleSaveConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextClientId = clientId.trim();
    const nextClientSecret = clientSecret.trim();

    if (!nextClientId) {
      setBackendError(t('export.googlePhotos.clientIdRequired'));
      return;
    }

    if (!nextClientSecret) {
      setBackendError(t('export.googlePhotos.clientSecretRequired'));
      return;
    }

    setIsSavingConfig(true);

    try {
      const result = await saveGooglePhotosOAuthConfigRequest({
        clientId: nextClientId,
        clientSecret: nextClientSecret
      });
      setOauthConfig(result);
      setClientId('');
      setClientSecret('');
      setIsSetupGuideExpanded(false);
      setStatusMessage(t('export.googlePhotos.configSaved'));
      setBackendError(null);
      openOnlySection('account');
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.configSaveError'));
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleClearConfig = async () => {
    if (isRunning) {
      setBackendError(t('export.googlePhotos.runningSetupLocked'));
      return;
    }

    setIsClearingConfig(true);

    try {
      await Promise.all(accounts.map((account) => deleteGooglePhotosAccountRequest(account.id)));
      const result = await deleteGooglePhotosOAuthConfigRequest();
      setOauthConfig(result);
      setAccounts([]);
      setClientId('');
      setClientSecret('');
      setSelectedAccountId('');
      setIsGoogleSignInPendingRefresh(false);
      setIsSetupGuideExpanded(false);
      resetGooglePhotosExportState(t('export.googlePhotos.configCleared'));
      openOnlySection('config');
      await loadAccounts(false);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.configClearError'));
    } finally {
      setIsClearingConfig(false);
    }
  };

  const handleCopyRedirectUri = async () => {
    if (!oauthConfig?.redirectUri) {
      return;
    }

    try {
      await navigator.clipboard.writeText(oauthConfig.redirectUri);
      setStatusMessage(t('export.googlePhotos.redirectCopied'));
    } catch {
      setBackendError(t('export.googlePhotos.redirectCopyError'));
    }
  };

  const handleSelectAccount = (accountId: string) => {
    if (accountId === selectedAccountId) {
      return;
    }

    if (isRunning) {
      setBackendError(t('export.googlePhotos.runningSetupLocked'));
      return;
    }

    setSelectedAccountId(accountId);
    resetGooglePhotosExportState(t('export.googlePhotos.accountChangeReset'));
  };

  const handleDeleteAccount = async () => {
    if (!selectedAccountId) {
      return;
    }

    if (isRunning) {
      setBackendError(t('export.googlePhotos.runningSetupLocked'));
      return;
    }

    const deletedAccountId = selectedAccountId;
    setIsDeletingAccount(true);

    try {
      await deleteGooglePhotosAccountRequest(deletedAccountId);
      resetGooglePhotosExportState(t('export.googlePhotos.accountDisconnected'));
      setSelectedAccountId('');
      await loadAccounts();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.accountDeleteError'));
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handlePreview = async () => {
    if (!sourceRoot || !selectedAccountId) {
      return;
    }

    setIsPreviewing(true);

    try {
      await testExportTargetRequest({ type: 'google-photos', accountId: selectedAccountId });
      const nextPreview = await previewGooglePhotosExportRequest({ accountId: selectedAccountId, sourceRoot });
      setPreview(nextPreview);
      setBackendError(null);
      openOnlySection('albums');
    } catch (error) {
      setPreview(null);
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.previewError'));
    } finally {
      setIsPreviewing(false);
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
            name: t('export.googlePhotos.defaultJobName'),
            sourceRoot,
            target: { type: 'google-photos', accountId: selectedAccountId }
          });

      saveExportJobSnapshot({
        backendJobId: job.job.id,
        status: job.job.status,
        sourceRoot,
        destinationPath: selectedAccount?.email ?? null,
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
      openOnlySection('progress');
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
        destinationPath: selectedAccount?.email ?? null,
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
        destinationPath: selectedAccount?.email ?? null,
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

  const renderAccordionHeader = (
    section: GooglePhotosAccordionSection,
    title: string,
    summary: string,
    status: string,
    statusClass: 'completed' | 'pending' | 'running' | 'failed' = 'pending'
  ) => {
    const isOpen = isSectionOpen(section);

    return (
      <button
        className="export-accordion-header"
        type="button"
        onClick={() => toggleSection(section)}
        aria-expanded={isOpen}
      >
        <span className={`export-accordion-chevron${isOpen ? ' is-open' : ''}`}>›</span>
        <span className="export-accordion-title">
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        <span className={`status-pill status-${statusClass}`}>{status}</span>
      </button>
    );
  };

  const configStatus = oauthConfig?.configured
    ? t(oauthConfig.source === 'env' ? 'export.googlePhotos.configuredFromEnv' : 'export.googlePhotos.configured')
    : t('export.googlePhotos.notConfigured');
  const accountStatus = accounts.length > 0
    ? t('export.googlePhotos.accountsConnected', { count: accounts.length })
    : t('export.googlePhotos.noAccountConnected');
  const albumStatus = selectedAccount ? t('export.googlePhotos.ready') : t('export.googlePhotos.waitingForAccount');
  const progressStatus = progress ? `${progressPercent}%` : t('export.googlePhotos.noJobStatus');
  const progressSummaryText = progress ? t('export.progressSummary', {
    completed: progress.completed,
    skipped: progress.skipped,
    failed: progress.failed,
    total: progress.total
  }) : t('export.noJob');

  return (
    <div className="page-stack export-page">
      <div className="page-header export-page-header">
        <div>
          <h2 className="page-title">{t('export.googlePhotos.title')}</h2>
          <p className="page-subtitle">{t('export.googlePhotos.subtitle')}</p>
        </div>
        <button className="btn btn-secondary export-back-button" type="button" onClick={() => navigate('/export')}>
          {t('export.backToProviders')}
        </button>
      </div>

      {!sourceRoot && <p className="error">{t('export.unavailable')}</p>}
      {backendError && <p className="error">{backendError}</p>}
      {statusMessage && <p className="success-message">{statusMessage}</p>}

      <section className="settings-panel export-panel google-photos-source-context">
        <p className="page-section-title">{t('export.sourceTitle')}</p>
        <p className="page-summary-note">{sourceRoot || t('export.noSource')}</p>
      </section>

      <section className="settings-panel export-panel export-accordion">
        <article className="export-accordion-section">
          {renderAccordionHeader('config', t('export.googlePhotos.configStep'), t('export.googlePhotos.configNote'), configStatus, oauthConfig?.configured ? 'completed' : 'pending')}
          {isSectionOpen('config') && (
            <form className="export-accordion-body" onSubmit={handleSaveConfig}>
              {oauthConfig?.configured && (
                <div className="google-photos-setup-summary">
                  <strong>{t('export.googlePhotos.setupConfiguredSummary')}</strong>
                  <span>{configStatus}</span>
                </div>
              )}

              {!oauthConfig?.configured && (
                <>
                  <div className="network-auth-grid">
                    <label className="folder-path-control">
                      <span>{t('export.googlePhotos.clientId')}</span>
                      <input
                        className="folder-path-input"
                        value={clientId}
                        onChange={(event) => setClientId(event.target.value)}
                        placeholder={t('export.googlePhotos.clientIdPlaceholder')}
                        type="text"
                        autoComplete="off"
                      />
                      <small className="field-hint">{t('export.googlePhotos.clientIdHint')}</small>
                    </label>

                    <label className="folder-path-control">
                      <span>{t('export.googlePhotos.clientSecret')}</span>
                      <input
                        className="folder-path-input"
                        value={clientSecret}
                        onChange={(event) => setClientSecret(event.target.value)}
                        placeholder={t('export.googlePhotos.clientSecretPlaceholder')}
                        type="password"
                        autoComplete="off"
                      />
                      <small className="field-hint">{t('export.googlePhotos.clientSecretHint')}</small>
                    </label>
                  </div>

                  <p className="page-summary-note">{t('export.googlePhotos.configPrivacyNote')}</p>
                </>
              )}

              <div className="network-export-tools">
                {!oauthConfig?.configured && (
                  <button className="btn btn-primary" type="submit" disabled={isSavingConfig}>
                    {isSavingConfig ? t('export.googlePhotos.savingConfig') : t('export.googlePhotos.saveConfig')}
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void handleClearConfig()}
                  disabled={isClearingConfig || isRunning || oauthConfig?.source !== 'local-db'}
                >
                  {isClearingConfig ? t('export.googlePhotos.clearingConfig') : t('export.googlePhotos.clearConfig')}
                </button>
              </div>

              <details className="google-photos-guide" open={isSetupGuideExpanded} onToggle={(event) => setIsSetupGuideExpanded(event.currentTarget.open)}>
                <summary>{t('export.googlePhotos.setupGuideTitle')}</summary>
                <div className="google-photos-step-list">
                  {setupSteps.map((step, index) => (
                    <article className="google-photos-step-card" key={step.title}>
                      <div className="google-photos-step-number">{index + 1}</div>
                      <div className="google-photos-step-body">
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                        {index === 3 && (
                          <div className="google-photos-copy-row">
                            <code>{oauthConfig?.redirectUri ?? ''}</code>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              onClick={() => void handleCopyRedirectUri()}
                              disabled={!oauthConfig?.redirectUri}
                            >
                              {t('export.googlePhotos.copyRedirectUri')}
                            </button>
                          </div>
                        )}
                        <div className="google-photos-doc-links">
                          <a href={step.primaryHref} target="_blank" rel="noreferrer">
                            {step.primaryLabel}
                          </a>
                          {step.secondaryHref && (
                            <a href={step.secondaryHref} target="_blank" rel="noreferrer">
                              {step.secondaryLabel}
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </details>
            </form>
          )}
        </article>

        <article className="export-accordion-section">
          {renderAccordionHeader('account', t('export.googlePhotos.accountStep'), t('export.googlePhotos.accountNote'), accountStatus, accounts.length > 0 ? 'completed' : 'pending')}
          {isSectionOpen('account') && (
            <div className="export-accordion-body">
              <div className="network-header-actions">
                <button className="btn btn-secondary" type="button" onClick={() => void loadAccounts(true, true)} disabled={isLoadingAccounts}>
                  {isLoadingAccounts ? t('export.googlePhotos.refreshingAccounts') : t('export.googlePhotos.refreshAccounts')}
                </button>
                {shouldShowConnectAccount && (
                  <button className="btn btn-primary" type="button" onClick={() => void handleConnect()} disabled={!canConnect}>
                    {isConnecting
                      ? t('export.googlePhotos.connecting')
                      : t(accounts.length > 0 ? 'export.googlePhotos.connectAnotherAccount' : 'export.googlePhotos.connectAccount')}
                  </button>
                )}
              </div>

              {accounts.length === 0 ? (
                <p className="network-empty-note">{t('export.googlePhotos.noAccounts')}</p>
              ) : (
                <div className="network-location-list" aria-label={t('export.googlePhotos.accountsAria')}>
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      className={`network-location-card${account.id === selectedAccountId ? ' is-selected' : ''}`}
                      type="button"
                      onClick={() => handleSelectAccount(account.id)}
                      disabled={isRunning}
                    >
                      <strong>{account.displayName || account.email}</strong>
                      <span>{account.email}</span>
                    </button>
                  ))}
                </div>
              )}

              {selectedAccount && (
                <div className="network-export-tools">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => void handleDeleteAccount()}
                    disabled={isDeletingAccount || isRunning}
                  >
                    {isDeletingAccount ? t('export.googlePhotos.disconnecting') : t('export.googlePhotos.disconnectAccount')}
                  </button>
                </div>
              )}
            </div>
          )}
        </article>

        <article className="export-accordion-section">
          {renderAccordionHeader('albums', t('export.googlePhotos.albumStep'), t('export.googlePhotos.albumLimitNote'), albumStatus, selectedAccount ? 'completed' : 'pending')}
          {isSectionOpen('albums') && (
            <div className="export-accordion-body">
              <div className="export-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void handlePreview()}
                  disabled={!sourceRoot || !selectedAccountId || isPreviewing}
                >
                  {isPreviewing ? t('export.googlePhotos.previewing') : t('export.googlePhotos.preview')}
                </button>
                <button className="btn btn-primary" type="button" onClick={() => void handleStart()} disabled={!canStart}>
                  {isStarting ? t('export.starting') : isPaused ? t('export.resume') : t('export.start')}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => void handlePause()} disabled={!backendJobId || !isRunning}>
                  {t('export.pause')}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => void handleRetryFailed()} disabled={!backendJobId || !progress?.failed}>
                  {t('export.retryFailed')}
                </button>
              </div>

              {preview && (
                <>
                  <div className="export-stats">
                    <div>
                      <strong>{preview.supportedItems}</strong>
                      <span>{t('export.googlePhotos.supported')}</span>
                    </div>
                    <div>
                      <strong>{preview.unsupportedItems}</strong>
                      <span>{t('export.googlePhotos.unsupported')}</span>
                    </div>
                    <div>
                      <strong>{preview.albums.length}</strong>
                      <span>{t('export.googlePhotos.albums')}</span>
                    </div>
                  </div>

                  {preview.albums.length > 0 && (
                    <div className="export-item-list">
                      {preview.albums.map((album) => (
                        <div key={album.albumTitle} className="export-item-row">
                          <div>
                            <strong title={album.albumTitle}>{album.albumTitle}</strong>
                            <span>{t('export.googlePhotos.albumItemCount', { count: album.itemCount })}</span>
                          </div>
                          <span className={`status-pill status-${album.status === 'existing' ? 'completed' : 'pending'}`}>
                            {album.status === 'existing' ? t('export.googlePhotos.albumExisting') : t('export.googlePhotos.albumNew')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </article>

        <article className="export-accordion-section">
          {renderAccordionHeader('progress', t('export.progressTitle'), progressSummaryText, progressStatus, progress ? 'running' : 'pending')}
          {isSectionOpen('progress') && (
            <div className="export-accordion-body">
              <div className="grouping-main-head">
                <div>
                  <p className="page-section-title">{t('export.progressTitle')}</p>
                  <p className="page-summary-note">{progressSummaryText}</p>
                </div>
                <div className="export-provider-inline">
                  <ExportProviderIcon visual="photos" />
                  <strong>{progressPercent}%</strong>
                </div>
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
            </div>
          )}
        </article>
      </section>
    </div>
  );
};

export default GooglePhotosExportPage;
