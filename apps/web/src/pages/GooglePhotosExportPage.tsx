import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useExportJobState } from '../hooks/useExportJobState';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import { resetExportJobSnapshot, saveExportJobSnapshot } from '../services/export-job.store';
import {
  createExportJobRequest,
  deleteGooglePhotosOAuthConfigRequest,
  deleteGooglePhotosAccountRequest,
  getExportJobRequest,
  getExportProgressRequest,
  getGooglePhotosOAuthConfigRequest,
  listGooglePhotosAccountsRequest,
  pauseExportJobRequest,
  previewGooglePhotosExportRequest,
  retryExportItemRequest,
  retryFailedExportItemsRequest,
  saveGooglePhotosOAuthConfigRequest,
  startExportJobRequest,
  startGooglePhotosOAuthRequest,
  testExportTargetRequest,
  updateGooglePhotosExportJobScopeRequest,
  type ExportItemStatus,
  type ExportJobSnapshot,
  type ExportProgress,
  type GooglePhotosAlbumProgress,
  type GooglePhotosAccount,
  type GooglePhotosExportPreview,
  type GooglePhotosOAuthConfigStatus
} from '../services/export.service';

type GooglePhotosRenderStatus = ExportItemStatus | 'paused';

const itemStatusLabels = {
  pending: 'export.itemStatus.pending',
  running: 'export.itemStatus.running',
  paused: 'export.itemStatus.paused',
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

type GooglePhotosAccordionSection = 'config' | 'account' | 'albums';
type GooglePhotosAlbumSessionStatus = 'completed' | 'failed' | 'skipped';

const createOpenSectionSet = (section: GooglePhotosAccordionSection) => new Set<GooglePhotosAccordionSection>([section]);

const getPendingAlbumTitleSet = (nextPreview: GooglePhotosExportPreview) =>
  new Set(nextPreview.albums.filter((album) => album.uploadStatus === 'pending').map((album) => album.albumTitle));

const getCheckpointAlbumTitleSet = (job: ExportJobSnapshot | null) => {
  if (!job?.checkpoint?.payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(job.checkpoint.payloadJson) as {
      target?: {
        type?: string;
        albumTitles?: unknown;
      };
    };
    const albumTitles = payload.target?.type === 'google-photos' && Array.isArray(payload.target.albumTitles)
      ? payload.target.albumTitles.filter((title): title is string => typeof title === 'string' && title.trim().length > 0)
      : null;

    return albumTitles ? new Set(albumTitles) : null;
  } catch {
    return null;
  }
};

const getAlbumTitleSetForJob = (nextPreview: GooglePhotosExportPreview, job: ExportJobSnapshot | null) =>
  getCheckpointAlbumTitleSet(job) ?? getPendingAlbumTitleSet(nextPreview);

const getNextAlbumTitleSelection = (current: Set<string>, albumTitle: string) => {
  const next = new Set(current);

  if (next.has(albumTitle)) {
    next.delete(albumTitle);
  } else {
    next.add(albumTitle);
  }

  return next;
};

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
  const [preview, setPreview] = useState<GooglePhotosExportPreview | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoadingOAuthConfig, setIsLoadingOAuthConfig] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isClearingConfig, setIsClearingConfig] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [restorePreviewAttemptKey, setRestorePreviewAttemptKey] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);
  const [isUpdatingAlbumScope, setIsUpdatingAlbumScope] = useState(false);
  const [isSetupGuideExpanded, setIsSetupGuideExpanded] = useState(false);
  const [isGoogleSignInPendingRefresh, setIsGoogleSignInPendingRefresh] = useState(false);
  const [openSections, setOpenSections] = useState<Set<GooglePhotosAccordionSection>>(() => createOpenSectionSet('config'));
  const [isAccordionManual, setIsAccordionManual] = useState(false);
  const [expandedAlbumTitles, setExpandedAlbumTitles] = useState<Set<string>>(() => new Set());
  const [selectedAlbumTitles, setSelectedAlbumTitles] = useState<Set<string>>(() => new Set());
  const [albumSessionStatuses, setAlbumSessionStatuses] = useState<Record<string, GooglePhotosAlbumSessionStatus>>({});
  const [activeBackendJobIdOverride, setActiveBackendJobIdOverride] = useState<string | null>(null);
  const selectedAlbumTitlesRef = useRef<Set<string>>(new Set());
  const confirmedSelectedAlbumTitlesRef = useRef<Set<string>>(new Set());
  const albumScopeUpdateRequestIdRef = useRef(0);

  const sourceRoot = groupingSessionState.outputRootLabel ?? '';
  const backendJobId = activeBackendJobIdOverride ?? exportJobState.backendJobId;
  const isExportSnapshotForBackendJob = Boolean(backendJobId && exportJobState.backendJobId === backendJobId);
  const exportStatus = isExportSnapshotForBackendJob ? exportJobState.status : 'idle';
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const currentProgress = progress?.jobId === backendJobId ? progress : null;
  const isPaused = currentProgress?.status === 'paused' || exportStatus === 'paused';
  const isRunning = currentProgress?.status === 'running' || exportStatus === 'running';
  const isTerminal = ['completed', 'failed', 'cancelled'].includes(currentProgress?.status ?? exportStatus);
  const hasPreview = Boolean(preview);
  const hasActiveUpload = isRunning || isPaused;
  const canConnect = Boolean(oauthConfig?.configured && !isConnecting);
  const shouldShowConnectAccount = Boolean(oauthConfig?.configured && (!isGoogleSignInPendingRefresh || accounts.length > 0));
  const recentItems = useMemo(() => currentProgress?.recentItems ?? [], [currentProgress]);

  useEffect(() => {
    selectedAlbumTitlesRef.current = selectedAlbumTitles;
  }, [selectedAlbumTitles]);

  const updateSelectedAlbumTitles = useCallback((next: Set<string>, persistConfirmed = false) => {
    selectedAlbumTitlesRef.current = next;
    setSelectedAlbumTitles(next);

    if (persistConfirmed) {
      confirmedSelectedAlbumTitlesRef.current = new Set(next);
    }
  }, []);

  const progressByAlbum = useMemo(() => {
    const entries = new Map<string, GooglePhotosAlbumProgress>();

    for (const album of currentProgress?.albumProgress ?? []) {
      entries.set(album.albumTitle, album);
    }

    return entries;
  }, [currentProgress?.albumProgress]);
  const previewUploadStatusByAlbum = useMemo(() => {
    const entries = new Map<string, GooglePhotosExportPreview['albums'][number]['uploadStatus']>();

    for (const album of preview?.albums ?? []) {
      entries.set(album.albumTitle, album.uploadStatus);
    }

    return entries;
  }, [preview?.albums]);
  const recentItemsByAlbum = useMemo(() => {
    const entries = new Map<string, typeof recentItems>();

    for (const item of recentItems) {
      const albumItems = entries.get(item.destinationPath) ?? [];
      albumItems.push(item);
      entries.set(item.destinationPath, albumItems);
    }

    return entries;
  }, [recentItems]);
  const shouldFocusProgress = Boolean(
    currentProgress?.status && ['running', 'paused', 'completed'].includes(currentProgress.status)
      || exportStatus === 'running'
      || exportStatus === 'paused'
      || exportStatus === 'completed'
  );
  const recommendedOpenSection = useMemo<GooglePhotosAccordionSection>(() => {
    if (shouldFocusProgress) return 'albums';
    if (isLoadingOAuthConfig) return 'config';
    if (!oauthConfig?.configured) return 'config';
    if (accounts.length === 0) return 'account';
    if (!preview) return 'albums';
    return 'albums';
  }, [accounts.length, isLoadingOAuthConfig, oauthConfig?.configured, preview, shouldFocusProgress]);
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

  const rememberCompletedAlbumProgress = useCallback((nextProgress: ExportProgress) => {
    if (!['completed', 'failed', 'cancelled'].includes(nextProgress.status)) {
      return;
    }

    setAlbumSessionStatuses((current) => {
      const next = { ...current };

      for (const album of nextProgress.albumProgress ?? []) {
        if (album.failed > 0 || album.status === 'failed') {
          next[album.albumTitle] = 'failed';
        } else if (album.skipped === album.total) {
          next[album.albumTitle] = 'skipped';
        } else if (album.completed + album.skipped >= album.total) {
          next[album.albumTitle] = 'completed';
        }
      }

      return next;
    });
  }, []);

  const syncSnapshot = useCallback(
    (nextProgress: ExportProgress) => {
      const completedAt = ['completed', 'failed', 'cancelled'].includes(nextProgress.status)
        ? exportJobState.backendJobId === nextProgress.jobId && exportJobState.completedAt
          ? exportJobState.completedAt
          : Date.now()
        : null;

      saveExportJobSnapshot({
        backendJobId: nextProgress.jobId,
        status: nextProgress.status,
        sourceRoot,
        groupingSessionId: groupingSessionState.backendSessionId,
        destinationPath: selectedAccount?.email ?? exportJobState.destinationPath,
        googlePhotosAccountId: selectedAccountId || exportJobState.googlePhotosAccountId,
        targetType: 'google-photos',
        totalItems: nextProgress.total,
        startedAt: exportJobState.backendJobId === nextProgress.jobId ? exportJobState.startedAt ?? Date.now() : Date.now(),
        completedAt,
        errorMessage: nextProgress.failed > 0 ? t('export.completedWithErrors', { count: nextProgress.failed }) : null,
        updatedAt: Date.now()
      });
      rememberCompletedAlbumProgress(nextProgress);
    },
    [
      exportJobState.destinationPath,
      exportJobState.backendJobId,
      exportJobState.completedAt,
      exportJobState.googlePhotosAccountId,
      exportJobState.startedAt,
      groupingSessionState.backendSessionId,
      rememberCompletedAlbumProgress,
      selectedAccount?.email,
      selectedAccountId,
      sourceRoot,
      t
    ]
  );

  const resetGooglePhotosExportState = useCallback((message?: string | null) => {
    setPreview(null);
    setProgress(null);
    setAlbumSessionStatuses({});
    setExpandedAlbumTitles(new Set());
    updateSelectedAlbumTitles(new Set(), true);
    setRestorePreviewAttemptKey('');
    setActiveBackendJobIdOverride(null);
    setBackendError(null);
    setStatusMessage(message ?? null);
    setIsGoogleSignInPendingRefresh(false);
    resetExportJobSnapshot('google-photos');
  }, [updateSelectedAlbumTitles]);

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

  const toggleAlbum = useCallback((albumTitle: string) => {
    setExpandedAlbumTitles((current) => {
      const next = new Set(current);

      if (next.has(albumTitle)) {
        next.delete(albumTitle);
      } else {
        next.add(albumTitle);
      }

      return next;
    });
  }, []);

  const toggleAlbumSelection = useCallback(async (albumTitle: string) => {
    const nextSelection = getNextAlbumTitleSelection(selectedAlbumTitlesRef.current, albumTitle);
    const nextAlbumTitles = [...nextSelection];

    updateSelectedAlbumTitles(nextSelection);

    if (!isPaused || !backendJobId) {
      return;
    }

    const requestId = albumScopeUpdateRequestIdRef.current + 1;
    albumScopeUpdateRequestIdRef.current = requestId;
    setIsUpdatingAlbumScope(true);

    try {
      const job = await updateGooglePhotosExportJobScopeRequest(backendJobId, nextAlbumTitles);
      const nextProgress = await getExportProgressRequest(job.job.id);

      if (requestId !== albumScopeUpdateRequestIdRef.current) {
        return;
      }

      setProgress(nextProgress);
      updateSelectedAlbumTitles(
        getCheckpointAlbumTitleSet(job) ?? new Set(nextAlbumTitles),
        true
      );
      syncSnapshot(nextProgress);
      setBackendError(null);
    } catch (error) {
      const job = await getExportJobRequest(backendJobId);

      if (requestId !== albumScopeUpdateRequestIdRef.current) {
        return;
      }

      updateSelectedAlbumTitles(
        getCheckpointAlbumTitleSet(job) ?? new Set(confirmedSelectedAlbumTitlesRef.current),
        true
      );
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.previewError'));
    } finally {
      if (requestId === albumScopeUpdateRequestIdRef.current) {
        setIsUpdatingAlbumScope(false);
      }
    }
  }, [
    backendJobId,
    isPaused,
    syncSnapshot,
    t,
    updateSelectedAlbumTitles
  ]);

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
    if (!backendJobId || (!isPaused && !isRunning && !isTerminal) || !sourceRoot || !selectedAccountId || preview) {
      return;
    }

    const attemptKey = `${backendJobId}:${selectedAccountId}:${groupingSessionState.backendSessionId ?? ''}:${sourceRoot}`;
    if (restorePreviewAttemptKey === attemptKey) {
      return;
    }

    setRestorePreviewAttemptKey(attemptKey);
    setIsPreviewing(true);
    openOnlySection('albums');

    void Promise.all([
      previewGooglePhotosExportRequest({
        accountId: selectedAccountId,
        sourceRoot,
        groupingSessionId: groupingSessionState.backendSessionId
      }),
      getExportJobRequest(backendJobId)
    ])
      .then(([nextPreview, job]) => {
        setPreview(nextPreview);
        updateSelectedAlbumTitles(getAlbumTitleSetForJob(nextPreview, job), true);
        setBackendError(null);
      })
      .catch((error) => {
        setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.previewError'));
      })
      .finally(() => setIsPreviewing(false));
  }, [
    backendJobId,
    groupingSessionState.backendSessionId,
    isPaused,
    isRunning,
    isTerminal,
    openOnlySection,
    preview,
    restorePreviewAttemptKey,
    selectedAccountId,
    sourceRoot,
    t,
    updateSelectedAlbumTitles
  ]);

  useEffect(() => {
    if (!currentProgress?.albumProgress?.length || (!isPaused && !isRunning)) {
      return;
    }

    openOnlySection('albums');
    const activeAlbum = currentProgress.albumProgress.find((album) => album.status === 'running')
      ?? currentProgress.albumProgress.find((album) => album.completed + album.skipped < album.total);

    if (activeAlbum) {
      setExpandedAlbumTitles((current) => current.size > 0 ? current : new Set([activeAlbum.albumTitle]));
    }
  }, [currentProgress?.albumProgress, isPaused, isRunning, openOnlySection]);

  useEffect(() => {
    setPreview(null);
    setProgress(null);
    setActiveBackendJobIdOverride(null);
    setAlbumSessionStatuses({});
    setExpandedAlbumTitles(new Set());
    updateSelectedAlbumTitles(new Set(), true);
  }, [selectedAccountId, sourceRoot, updateSelectedAlbumTitles]);

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
      const nextPreview = await previewGooglePhotosExportRequest({
        accountId: selectedAccountId,
        sourceRoot,
        groupingSessionId: groupingSessionState.backendSessionId
      });
      setPreview(nextPreview);
      updateSelectedAlbumTitles(getPendingAlbumTitleSet(nextPreview), true);
      setAlbumSessionStatuses({});
      setExpandedAlbumTitles(new Set());
      setBackendError(null);
      openOnlySection('albums');
    } catch (error) {
      setPreview(null);
      updateSelectedAlbumTitles(new Set(), true);
      setBackendError(error instanceof Error ? error.message : t('export.googlePhotos.previewError'));
    } finally {
      setIsPreviewing(false);
    }
  };

  const saveGooglePhotosJobSnapshot = (job: Awaited<ReturnType<typeof createExportJobRequest>>) => {
    saveExportJobSnapshot({
      backendJobId: job.job.id,
      status: job.job.status,
      sourceRoot,
      groupingSessionId: groupingSessionState.backendSessionId,
      destinationPath: selectedAccount?.email ?? null,
      googlePhotosAccountId: selectedAccountId,
      targetType: 'google-photos',
      totalItems: job.job.totalItems,
      startedAt: Date.now(),
      completedAt: null,
      errorMessage: null,
      updatedAt: Date.now()
    });
  };

  const handleStart = async (albumTitle?: string) => {
    if (!canStart) {
      return;
    }

    setIsStarting(true);

    try {
      const shouldResume = Boolean(isPaused && backendJobId);
      const resumeJobId = shouldResume ? backendJobId : null;
      const albumTitles = albumTitle ? [albumTitle] : selectedPendingAlbumTitles;
      let job = resumeJobId
        ? await startExportJobRequest(resumeJobId)
        : await createExportJobRequest({
            name: albumTitle
              ? t('export.googlePhotos.albumJobName', { albumTitle })
              : t('export.googlePhotos.defaultJobName'),
            sourceRoot,
            groupingSessionId: groupingSessionState.backendSessionId ?? undefined,
            target: {
              type: 'google-photos',
              accountId: selectedAccountId,
              ...(albumTitles.length > 0 ? { albumTitles } : {})
            }
          });

      if (!shouldResume && job.job.totalItems === 0) {
        const noPendingJob = job;
        const nextPreview = await previewGooglePhotosExportRequest({
          accountId: selectedAccountId,
          sourceRoot,
          groupingSessionId: groupingSessionState.backendSessionId
        });
        setPreview(nextPreview);
        updateSelectedAlbumTitles(getAlbumTitleSetForJob(nextPreview, noPendingJob), true);
        setProgress(null);
        setActiveBackendJobIdOverride(null);
        setAlbumSessionStatuses({});
        setBackendError(null);
        setStatusMessage(t('export.googlePhotos.noPendingItems'));
        openOnlySection('albums');
        return;
      }

      if (!shouldResume) {
        setActiveBackendJobIdOverride(job.job.id);
        saveGooglePhotosJobSnapshot(job);
        const initialProgress = await getExportProgressRequest(job.job.id);
        setProgress(initialProgress);
        job = await startExportJobRequest(job.job.id);
        saveGooglePhotosJobSnapshot(job);
      }

      const nextProgress = await getExportProgressRequest(job.job.id);
      setProgress(nextProgress);
      syncSnapshot(nextProgress);
      setBackendError(null);
      openOnlySection('albums');
      if (albumTitle) {
        setExpandedAlbumTitles((current) => new Set([...current, albumTitle]));
      }
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
        groupingSessionId: groupingSessionState.backendSessionId,
        destinationPath: selectedAccount?.email ?? null,
        googlePhotosAccountId: selectedAccountId,
        targetType: 'google-photos',
        totalItems: job.job.totalItems,
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
        groupingSessionId: groupingSessionState.backendSessionId,
        destinationPath: selectedAccount?.email ?? null,
        googlePhotosAccountId: selectedAccountId,
        targetType: 'google-photos',
        totalItems: job.job.totalItems,
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

  const handleRetryItem = async (itemId: string, itemJobId?: string | null) => {
    const effectiveJobId = itemJobId ?? backendJobId;

    if (!effectiveJobId || isRunning) return;

    setRetryingItemId(itemId);

    try {
      const job = await retryExportItemRequest(effectiveJobId, itemId);
      setActiveBackendJobIdOverride(effectiveJobId);
      saveExportJobSnapshot({
        backendJobId: effectiveJobId,
        status: job.job.status,
        sourceRoot,
        groupingSessionId: groupingSessionState.backendSessionId,
        destinationPath: selectedAccount?.email ?? null,
        googlePhotosAccountId: selectedAccountId,
        targetType: 'google-photos',
        totalItems: job.job.totalItems,
        startedAt: exportJobState.startedAt ?? Date.now(),
        completedAt: null,
        errorMessage: null,
        updatedAt: Date.now()
      });
      await startExportJobRequest(effectiveJobId);
      const nextProgress = await getExportProgressRequest(effectiveJobId);
      setProgress(nextProgress);
      syncSnapshot(nextProgress);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('export.retryError'));
    } finally {
      setRetryingItemId(null);
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

  const shouldHideAlbumsWhilePreviewing = isPreviewing && !preview;
  const visibleAlbums = shouldHideAlbumsWhilePreviewing
    ? []
    : preview?.albums ?? (currentProgress?.albumProgress ?? []).map((album) => ({
        folderName: album.albumTitle,
        albumTitle: album.albumTitle,
        status: 'existing' as const,
        uploadStatus: 'pending' as const,
        itemCount: album.total,
        items: []
      }));
  const getItemRenderStatus = (status: ExportItemStatus): GooglePhotosRenderStatus => {
    if (isPaused && status === 'running') {
      return 'paused';
    }

    return status;
  };

  const getAlbumDisplayItems = (
    albumTitle: string,
    previewItems: GooglePhotosExportPreview['albums'][number]['items'],
    isAlbumComplete: boolean
  ) => {
    const progressItems = recentItemsByAlbum.get(albumTitle) ?? [];
    const progressByRelativePath = new Map(progressItems.map((item) => [item.relativePath, item]));

    return previewItems.map((item) => {
      const progressItem = progressByRelativePath.get(item.relativePath);
      const shouldKeepPreviewState =
        item.status === 'completed'
        && progressItem?.status === 'failed'
        && Boolean(item.id)
        && progressItem.id !== item.id;
      const effectiveProgressItem = shouldKeepPreviewState ? null : progressItem;
      const status = getItemRenderStatus(effectiveProgressItem?.status ?? item.status ?? (isAlbumComplete ? 'completed' : 'pending'));

      return {
        relativePath: item.relativePath,
        sizeBytes: effectiveProgressItem?.sizeBytes ?? item.sizeBytes,
        status,
        id: effectiveProgressItem?.id ?? item.id ?? null,
        jobId: effectiveProgressItem ? backendJobId : item.jobId ?? null,
        lastError: effectiveProgressItem
          ? effectiveProgressItem.lastError ?? null
          : status === 'failed'
            ? item.lastError ?? null
            : null
      };
    });
  };

  const getShortErrorMessage = (error: string) => {
    const marker = '. Album:';
    const markerIndex = error.indexOf(marker);
    return markerIndex > 0 ? error.slice(0, markerIndex + 1) : error;
  };

  const getAlbumFailureSummary = (items: ReturnType<typeof getAlbumDisplayItems>) => {
    if (items.length === 0) {
      return null;
    }

    const failedItems = items.filter((item) => item.status === 'failed' && item.lastError);

    if (failedItems.length !== items.length) {
      return null;
    }

    const uniqueErrors = new Set(failedItems.map((item) => item.lastError));
    return uniqueErrors.size === 1 ? failedItems[0].lastError : null;
  };

  const getDerivedAlbumView = (album: typeof visibleAlbums[number]) => {
    const albumProgress = progressByAlbum.get(album.albumTitle);
    const previewItemStatuses = album.items
      .map((item) => item.status)
      .filter((status): status is ExportItemStatus => Boolean(status));
    const previewFailedCount = previewItemStatuses.filter((status) => status === 'failed').length;
    const previewCompletedCount = previewItemStatuses.filter((status) => status === 'completed' || status === 'skipped').length;
    const previewSupportedCount = album.items.filter((item) => item.supported).length;
    const fallbackComplete = album.uploadStatus === 'completed'
      || (previewSupportedCount > 0 && previewFailedCount === 0 && previewCompletedCount === previewSupportedCount);
    const items = getAlbumDisplayItems(album.albumTitle, album.items, fallbackComplete);

    if (items.length === 0) {
      const totalCount = albumProgress?.total ?? album.itemCount;
      const completedCount = albumProgress?.completed ?? 0;
      const skippedCount = albumProgress?.skipped ?? 0;
      const failedCount = albumProgress?.failed ?? 0;
      const pendingCount = Math.max(albumProgress?.pending ?? totalCount - completedCount - skippedCount - failedCount, 0);
      const hasTrackedAlbumActivity = completedCount > 0 || skippedCount > 0 || failedCount > 0 || pendingCount < totalCount;
      const status = albumProgress?.status === 'running' && hasTrackedAlbumActivity
        ? (isPaused ? 'paused' : 'running')
        : albumProgress?.status === 'failed'
        ? 'failed'
        : albumProgress?.status === 'skipped'
        ? 'skipped'
        : fallbackComplete
        ? 'completed'
        : 'pending';

      return {
        ...album,
        albumType: album.status,
        albumProgress,
        items,
        totalCount,
        completedCount,
        skippedCount,
        failedCount,
        pendingCount,
        derivedStatus: status,
        isComplete: status === 'completed' || status === 'skipped',
        progressPercent: totalCount > 0 ? Math.round(((completedCount + skippedCount) / totalCount) * 100) : 0,
        failureSummary: null
      };
    }

    const totalCount = album.itemCount;
    const completedCount = items.filter((item) => item.status === 'completed').length;
    const skippedCount = items.filter((item) => item.status === 'skipped').length;
    const failedCount = items.filter((item) => item.status === 'failed').length;
    const runningCount = items.filter((item) => item.status === 'running' || item.status === 'paused').length;
    const pendingCount = Math.max(totalCount - completedCount - skippedCount - failedCount - runningCount, 0);
    const status: GooglePhotosRenderStatus = failedCount > 0
      ? 'failed'
      : runningCount > 0
      ? (isPaused ? 'paused' : 'running')
      : totalCount > 0 && completedCount + skippedCount >= totalCount
      ? (skippedCount === totalCount ? 'skipped' : 'completed')
      : 'pending';

    return {
      ...album,
      albumType: album.status,
      albumProgress,
      items,
      totalCount,
      completedCount,
      skippedCount,
      failedCount,
      pendingCount,
      derivedStatus: status,
      isComplete: status === 'completed' || status === 'skipped',
      progressPercent: totalCount > 0 ? Math.round(((completedCount + skippedCount) / totalCount) * 100) : 0,
      failureSummary: getAlbumFailureSummary(items)
    };
  };

  const getAlbumResultLabel = (album: ReturnType<typeof getDerivedAlbumView>) => {
    if (album.derivedStatus === 'completed') {
      return t('export.googlePhotos.albumUploaded');
    }

    if (album.derivedStatus === 'failed') {
      return t('export.googlePhotos.albumFailed');
    }

    if (album.derivedStatus === 'skipped') {
      return t('export.googlePhotos.albumSkipped');
    }

    if (album.derivedStatus === 'running') {
      return isPaused ? t('export.itemStatus.paused') : t('export.googlePhotos.albumUploading');
    }

    if (album.derivedStatus === 'pending' && isPaused) {
      return t('export.itemStatus.paused');
    }

    return null;
  };

  const derivedVisibleAlbums = visibleAlbums.map((album) => getDerivedAlbumView(album));
  const pendingVisibleAlbums = derivedVisibleAlbums.filter((album) =>
    album.uploadStatus === 'pending' && !album.isComplete
  );
  const selectedPendingAlbumTitles = pendingVisibleAlbums
    .filter((album) => selectedAlbumTitles.has(album.albumTitle))
    .map((album) => album.albumTitle);
  const excludedPendingAlbumCount = Math.max(0, pendingVisibleAlbums.length - selectedPendingAlbumTitles.length);
  const selectionSummary = preview
    ? t('export.googlePhotos.albumSelectionSummary', {
        selected: selectedPendingAlbumTitles.length,
        excluded: excludedPendingAlbumCount
      })
    : null;
  const visibleFailedItemCount = derivedVisibleAlbums.reduce((sum, album) => sum + album.failedCount, 0);
  const googlePhotosNotices = (currentProgress?.notices ?? []).map((notice) => {
    if (notice.startsWith('google-photos-album-recreated:')) {
      return t('export.googlePhotos.albumRecoveredNotice', {
        albumTitle: notice.slice('google-photos-album-recreated:'.length)
      });
    }

    return notice;
  });
  const isAllVisibleExportCompletedSuccessfully = Boolean(
    preview?.albums.length
      && derivedVisibleAlbums.every((album) => album.isComplete)
  );
  const canStart = Boolean(
    sourceRoot
      && selectedAccountId
      && !isStarting
      && !isUpdatingAlbumScope
      && (preview || isPaused)
      && (!hasActiveUpload || isPaused)
      && selectedPendingAlbumTitles.length > 0
  );
  const isPreviewDisabled = Boolean(
    !sourceRoot || !selectedAccountId || isPreviewing || hasPreview || hasActiveUpload
  );

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
          {isSectionOpen('albums') && (
            <div className="export-accordion-body" aria-busy={shouldHideAlbumsWhilePreviewing}>
              <div className="export-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => void handlePreview()}
                  disabled={isPreviewDisabled}
                >
                  {isPreviewing ? t('export.googlePhotos.previewing') : t('export.googlePhotos.preview')}
                </button>
                <button
                  className="btn btn-primary google-photos-upload-action"
                  type="button"
                  onClick={() => void handleStart()}
                  disabled={!canStart || isAllVisibleExportCompletedSuccessfully}
                >
                  {isStarting ? t('export.starting') : isPaused ? t('export.resume') : t('export.googlePhotos.uploadSelectedAlbums')}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => void handlePause()} disabled={!backendJobId || !isRunning || isAllVisibleExportCompletedSuccessfully}>
                  {t('export.pause')}
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => void handleRetryFailed()} disabled={!backendJobId || visibleFailedItemCount === 0 || isAllVisibleExportCompletedSuccessfully}>
                  {t('export.retryFailed')}
                </button>
              </div>

              {selectionSummary && (
                <p className={`google-photos-selection-summary${selectedPendingAlbumTitles.length === 0 ? ' is-empty' : ''}`}>
                  {selectionSummary}
                </p>
              )}

              {shouldHideAlbumsWhilePreviewing && (
                <div className="google-photos-preview-loading" role="status" aria-live="polite">
                  <strong>{t('export.googlePhotos.previewLoadingTitle')}</strong>
                  <p>{t('export.googlePhotos.previewLoadingBody')}</p>
                </div>
              )}

              {visibleAlbums.length > 0 && (
                <>
                  {visibleAlbums.length > 0 && (
                    <div className="google-photos-album-list">
                      {derivedVisibleAlbums.map((album) => {
                        const isAlbumOpen = expandedAlbumTitles.has(album.albumTitle);
                        const isAlbumComplete = album.isComplete;
                        const hasAlbumProcessingStarted = Boolean(
                          album.completedCount > 0
                          || album.failedCount > 0
                          || album.skippedCount > 0
                          || album.derivedStatus === 'running'
                          || album.derivedStatus === 'paused'
                          || (
                            album.albumProgress
                            && (
                              album.albumProgress.completed > 0
                              || album.albumProgress.failed > 0
                              || album.albumProgress.skipped > 0
                              || album.albumProgress.status === 'running'
                            )
                          )
                        );
                        const isAlbumPending = album.uploadStatus === 'pending' && !isAlbumComplete;
                        const isAlbumSelected = selectedAlbumTitles.has(album.albumTitle);
                        const isAlbumChecked = isAlbumComplete || isAlbumSelected;
                        const isAlbumSelectable = isAlbumPending && !isRunning && (!isPaused || !hasAlbumProcessingStarted);
                        const resultLabel = getAlbumResultLabel(album);

                        return (
                          <article className="google-photos-album-panel" key={album.albumTitle}>
                            <div className="google-photos-album-header">
                              <label className={`google-photos-album-select${!isAlbumChecked ? ' is-excluded' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={isAlbumChecked}
                                  onChange={() => void toggleAlbumSelection(album.albumTitle)}
                                  disabled={!isAlbumSelectable}
                                />
                                <span>
                                  {isAlbumComplete
                                    ? t('export.googlePhotos.albumUploaded')
                                    : isAlbumSelected
                                    ? t('export.googlePhotos.albumSelected')
                                    : t('export.googlePhotos.albumExcluded')}
                                </span>
                              </label>
                              <button
                                className="google-photos-album-toggle"
                                type="button"
                                onClick={() => toggleAlbum(album.albumTitle)}
                                aria-expanded={isAlbumOpen}
                              >
                                <span className={`export-accordion-chevron${isAlbumOpen ? ' is-open' : ''}`}>›</span>
                                <span>
                                  <strong title={album.albumTitle}>{album.albumTitle}</strong>
                                  <small>{t('export.googlePhotos.albumItemCount', { count: album.itemCount })}</small>
                                </span>
                              </button>
                              <div className="google-photos-album-actions">
                                <span className={`status-pill status-${album.albumType === 'existing' ? 'completed' : 'pending'}`}>
                                  {album.albumType === 'existing' ? t('export.googlePhotos.albumExisting') : t('export.googlePhotos.albumNew')}
                                </span>
                                {resultLabel && (
                                  <span className={`status-pill status-${album.derivedStatus}`}>{resultLabel}</span>
                                )}
                                <button
                                  className="btn btn-primary btn-compact google-photos-upload-action"
                                  type="button"
                                  onClick={() => void handleStart(album.albumTitle)}
                                  disabled={!canStart || hasActiveUpload || isAlbumComplete || !isAlbumSelected || isAllVisibleExportCompletedSuccessfully}
                                >
                                  {isAlbumComplete ? t('export.googlePhotos.albumUploaded') : t('export.googlePhotos.uploadAlbum')}
                                </button>
                              </div>
                            </div>

                            {isAlbumOpen && (
                              <div className="google-photos-album-body">
                                {(album.items.length > 0 || album.albumProgress) ? (
                                  <>
                                    <div className="progress-track" aria-label={t('export.progressAria')}>
                                      <div className="export-progress-fill" style={{ width: `${album.progressPercent}%` }} />
                                    </div>
                                    <div className="export-stats">
                                      <div>
                                        <strong>{album.totalCount}</strong>
                                        <span>{t('export.total')}</span>
                                      </div>
                                      <div>
                                        <strong>{album.completedCount}</strong>
                                        <span>{t('export.completed')}</span>
                                      </div>
                                      <div>
                                        <strong>{album.skippedCount}</strong>
                                        <span>{t('export.skipped')}</span>
                                      </div>
                                      <div>
                                        <strong>{album.failedCount}</strong>
                                        <span>{t('export.failed')}</span>
                                      </div>
                                    </div>
                                  </>
                                ) : null}

                                {album.failureSummary && (
                                  <p className="google-photos-album-error-summary">{album.failureSummary}</p>
                                )}

                                {album.items.length > 0 && (
                                  <div className="export-item-list">
                                    {album.items.map((item) => (
                                      <div key={item.relativePath} className="export-item-row">
                                        <div>
                                          <strong title={item.relativePath}>{item.relativePath}</strong>
                                          <span>{formatBytes(item.sizeBytes)}</span>
                                          {item.status === 'failed' && item.lastError && (
                                            <details className="export-item-error">
                                              <summary>{getShortErrorMessage(item.lastError)}</summary>
                                              <span>{item.lastError}</span>
                                            </details>
                                          )}
                                        </div>
                                        <div className="export-item-row-actions">
                                          {item.status === 'failed' && item.id && (
                                            <button
                                              className="btn btn-secondary btn-compact"
                                              type="button"
                                              onClick={() => void handleRetryItem(item.id as string, item.jobId)}
                                              disabled={isRunning || retryingItemId === item.id}
                                            >
                                              {retryingItemId === item.id ? t('export.retrying') : t('export.retryItem')}
                                            </button>
                                          )}
                                          <span className={`status-pill status-${item.status}`}>{t(itemStatusLabels[item.status])}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </article>
      </section>
    </div>
  );
};

export default GooglePhotosExportPage;
