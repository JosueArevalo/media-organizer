import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExportWorkflowPanel } from '../components/ExportWorkflowPanel';
import { useExportWorkflow } from '../hooks/useExportWorkflow';
import { useExportJobState } from '../hooks/useExportJobState';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import {
  deleteGooglePhotosOAuthConfigRequest, deleteGooglePhotosAccountRequest,
  getGooglePhotosOAuthConfigRequest, listGooglePhotosAccountsRequest,
  saveGooglePhotosOAuthConfigRequest, startGooglePhotosOAuthRequest, testExportTargetRequest,
  type GooglePhotosAccount, type GooglePhotosOAuthConfigStatus
} from '../services/export.service';

const googlePhotosSetupLinks = {
  project: 'https://console.cloud.google.com/projectselector2/home/dashboard',
  photosApi: 'https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com',
  authOverview: 'https://console.cloud.google.com/auth/overview',
  authAudience: 'https://console.cloud.google.com/auth/audience',
  authClients: 'https://console.cloud.google.com/auth/clients',
  credentials: 'https://console.cloud.google.com/apis/credentials'
} as const;

type GooglePhotosAccordionSection = 'config' | 'account' | 'albums';
const createOpenSectionSet = (section: GooglePhotosAccordionSection) => new Set<GooglePhotosAccordionSection>([section]);

export const GooglePhotosExportPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupingSessionState = useGroupingSessionState();
  const exportJobState = useExportJobState('google-photos', {
    groupingSessionId: groupingSessionState.backendSessionId,
    sourceRoot: groupingSessionState.outputRootLabel
  });
  const [accounts, setAccounts] = useState<GooglePhotosAccount[]>([]);
  const [oauthConfig, setOauthConfig] = useState<GooglePhotosOAuthConfigStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [backendError, setBackendError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoadingOAuthConfig, setIsLoadingOAuthConfig] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isClearingConfig, setIsClearingConfig] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isSetupGuideExpanded, setIsSetupGuideExpanded] = useState(false);
  const [isGoogleSignInPendingRefresh, setIsGoogleSignInPendingRefresh] = useState(false);
  const [openSections, setOpenSections] = useState<Set<GooglePhotosAccordionSection>>(() => createOpenSectionSet('config'));
  const [isAccordionManual, setIsAccordionManual] = useState(false);

  const sourceRoot = groupingSessionState.outputRootLabel ?? '';
  const selectedAccount = useMemo(() => accounts.find((account) => account.id === selectedAccountId) ?? null, [accounts, selectedAccountId]);
  const workflow = useExportWorkflow({
    sourceRoot, groupingSessionId: groupingSessionState.backendSessionId,
    enabled: Boolean(selectedAccountId),
    adapter: {
      target: { type: 'google-photos', accountId: selectedAccountId },
      destinationLabel: selectedAccount?.email ?? '',
      defaultJobName: t('export.googlePhotos.defaultJobName'),
      groupJobName: (albumTitle) => t('export.googlePhotos.albumJobName', { albumTitle }),
      prepare: async () => {
        const result = await testExportTargetRequest({ type: 'google-photos', accountId: selectedAccountId });
        if (!result.ok) throw new Error(result.message);
      }
    }
  });
  const { isRunning, isPaused, preview } = workflow;
  const shouldFocusProgress = Boolean(workflow.job);
  const canConnect = Boolean(oauthConfig?.configured && !isConnecting);
  const shouldShowConnectAccount = Boolean(oauthConfig?.configured && (!isGoogleSignInPendingRefresh || accounts.length > 0));
  const recommendedOpenSection = useMemo<GooglePhotosAccordionSection>(() => {
    if (shouldFocusProgress) return 'albums';
    if (isLoadingOAuthConfig || !oauthConfig?.configured) return 'config';
    if (accounts.length === 0) return 'account';
    return 'albums';
  }, [accounts.length, isLoadingOAuthConfig, oauthConfig?.configured, shouldFocusProgress]);
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

  const resetGooglePhotosExportState = (message?: string | null) => {
    workflow.reset();
    setBackendError(null);
    setStatusMessage(message ?? null);
    setIsGoogleSignInPendingRefresh(false);
  };

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

        if (result.accounts.some((account) => account.id === current)) {
          return current;
        }

        const restoredAccount = result.accounts.find((account) =>
          account.id === exportJobState.googlePhotosAccountId
          || account.email === exportJobState.destinationPath
        );
        return restoredAccount?.id ?? result.accounts[0]?.id ?? '';
      });
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.accountsLoadError'));
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [exportJobState.destinationPath, exportJobState.googlePhotosAccountId, openSectionsManually, t]);

  const loadOAuthConfig = useCallback(async () => {
    setIsLoadingOAuthConfig(true);

    try {
      const result = await getGooglePhotosOAuthConfigRequest();
      setOauthConfig(result);
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.configLoadError'));
    } finally {
      setIsLoadingOAuthConfig(false);
    }
  }, [t]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadOAuthConfig();
  }, [loadOAuthConfig]);

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

  const configStatus = isLoadingOAuthConfig
    ? t('export.googlePhotos.loadingConfig')
    : oauthConfig?.configured
    ? t(oauthConfig.source === 'env' ? 'export.googlePhotos.configuredFromEnv' : 'export.googlePhotos.configured')
    : t('export.googlePhotos.notConfigured');
  const accountStatus = isLoadingAccounts && accounts.length === 0
    ? t('export.googlePhotos.loadingAccounts')
    : accounts.length > 0
    ? t('export.googlePhotos.accountsConnected', { count: accounts.length })
    : t('export.googlePhotos.noAccountConnected');
  const albumStatus = selectedAccount ? t('export.googlePhotos.ready') : t('export.googlePhotos.waitingForAccount');

  const googlePhotosNotices = (workflow.progress?.notices ?? []).map((notice) => {
    if (notice.startsWith('google-photos-album-recreated:')) {
      return t('export.googlePhotos.albumRecoveredNotice', {
        albumTitle: notice.slice('google-photos-album-recreated:'.length)
      });
    }

    return notice;
  });
  return (
    <div className="page-stack export-page">
      <div className="page-header export-page-header">
        <div>
          <h1 className="page-title">{t('export.googlePhotos.title')}</h1>
          <p className="page-subtitle">{t('export.googlePhotos.subtitle')}</p>
        </div>
        <button className="btn btn-secondary export-back-button" type="button" onClick={() => navigate('/export')}>
          {t('export.backToProviders')}
        </button>
      </div>

      {!sourceRoot && <p className="error">{t('export.unavailable')}</p>}
      {backendError && <p className="error">{backendError}</p>}
      {statusMessage && <p className="success-message">{statusMessage}</p>}
      {googlePhotosNotices.map((notice) => (
        <p className="success-message" key={notice}>{notice}</p>
      ))}

      <section className="settings-panel export-panel google-photos-source-context">
        <p className="page-section-title">{t('export.sourceTitle')}</p>
        <p className="page-summary-note">{sourceRoot || t('export.noSource')}</p>
      </section>

      <section className="settings-panel export-panel export-accordion">
        <article className="export-accordion-section">
          {renderAccordionHeader('config', t('export.googlePhotos.configStep'), t('export.googlePhotos.configNote'), configStatus, oauthConfig?.configured ? 'completed' : 'pending')}
          {isSectionOpen('config') && (
            <form className="export-accordion-body" onSubmit={handleSaveConfig}>
              {isLoadingOAuthConfig && (
                <p className="network-empty-note">{t('export.googlePhotos.loadingConfig')}</p>
              )}

              {!isLoadingOAuthConfig && oauthConfig?.configured && (
                <div className="google-photos-setup-summary">
                  <strong>{t('export.googlePhotos.setupConfiguredSummary')}</strong>
                  <span>{configStatus}</span>
                </div>
              )}

              {!isLoadingOAuthConfig && !oauthConfig?.configured && (
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
                {!isLoadingOAuthConfig && !oauthConfig?.configured && (
                  <button className="btn btn-primary" type="submit" disabled={isSavingConfig}>
                    {isSavingConfig ? t('export.googlePhotos.savingConfig') : t('export.googlePhotos.saveConfig')}
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void handleClearConfig()}
                  disabled={isLoadingOAuthConfig || isClearingConfig || isRunning || oauthConfig?.source !== 'local-db'}
                >
                  {isClearingConfig ? t('export.googlePhotos.clearingConfig') : t('export.googlePhotos.clearConfig')}
                </button>
              </div>

              {!isLoadingOAuthConfig && <details className="google-photos-guide" open={isSetupGuideExpanded} onToggle={(event) => setIsSetupGuideExpanded(event.currentTarget.open)}>
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
              </details>}
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

              {isLoadingAccounts && accounts.length === 0 ? (
                <p className="network-empty-note">{t('export.googlePhotos.loadingAccounts')}</p>
              ) : accounts.length === 0 ? (
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
          {isSectionOpen('albums') && <div className="export-accordion-body">
            <ExportWorkflowPanel workflow={workflow} provider="google-photos" />
          </div>}
        </article>
      </section>
    </div>
  );
};

export default GooglePhotosExportPage;
