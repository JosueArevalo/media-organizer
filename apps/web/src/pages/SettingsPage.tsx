import { useEffect, useState } from 'react';
import {
  loadEncoderSettings,
  saveEncoderSettings,
  type EncoderSettingsSnapshot
} from '../services/encoder-settings.store';
import { loadFolderSelections } from '../services/folder-selection.store';
import { resetRuntimeStateWithBackend } from '../services/app-maintenance.store';
import {
  COMPLETION_NOTIFICATION_EVENT_KEYS,
  loadCompletionNotificationSettings,
  saveCompletionNotificationSettings,
  type CompletionNotificationEventKey,
  type CompletionNotificationSettings
} from '../services/completion-notification-settings.store';
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  testCompletionNotification,
  type CompletionNotificationBlockedReason,
  type CompletionNotificationResult
} from '../services/completion-notification.service';
import { resetCompressionSession } from '../services/compression-job.store';
import { pickFileRequest } from '../services/system-picker.service';
import {
  getEffectiveToolCommand,
  isWindowsPlatform,
  loadToolsStatusRequest,
  type ExternalToolStatusSnapshot,
  type ToolsStatusSnapshot,
  type ToolStatus
} from '../services/tool-status.service';
import { useTranslation, type TranslationKey } from '../i18n';
import '../styles/SettingsPage.css';

type ToolKey = 'image' | 'video' | 'imagemagick' | 'exiftool';
type BrowserPermissionState = NotificationPermission | 'unsupported';

const notificationEventLabelKeys: Record<CompletionNotificationEventKey, {
  title: TranslationKey;
  description: TranslationKey;
}> = {
  compressionCompleted: {
    title: 'settings.notifications.event.compressionCompleted',
    description: 'settings.notifications.event.compressionCompletedDescription'
  },
  exportCompleted: {
    title: 'settings.notifications.event.exportCompleted',
    description: 'settings.notifications.event.exportCompletedDescription'
  },
  selectionLoaded: {
    title: 'settings.notifications.event.selectionLoaded',
    description: 'settings.notifications.event.selectionLoadedDescription'
  },
  groupingReorganized: {
    title: 'settings.notifications.event.groupingReorganized',
    description: 'settings.notifications.event.groupingReorganizedDescription'
  },
  organizationApplied: {
    title: 'settings.notifications.event.organizationApplied',
    description: 'settings.notifications.event.organizationAppliedDescription'
  }
};

const permissionLabelKeys: Record<BrowserPermissionState, TranslationKey> = {
  granted: 'settings.notifications.permission.granted',
  denied: 'settings.notifications.permission.denied',
  default: 'settings.notifications.permission.default',
  unsupported: 'settings.notifications.permission.unsupported'
};

const blockedReasonLabelKeys: Record<CompletionNotificationBlockedReason, TranslationKey> = {
  'event-disabled': 'settings.notifications.blocked.eventDisabled',
  duplicate: 'settings.notifications.blocked.duplicate',
  'no-channels-enabled': 'settings.notifications.blocked.noChannels',
  'audio-unsupported': 'settings.notifications.blocked.audioUnsupported',
  'audio-blocked': 'settings.notifications.blocked.audioBlocked',
  'notification-unsupported': 'settings.notifications.blocked.notificationUnsupported',
  'notification-permission-default': 'settings.notifications.blocked.notificationPermissionDefault',
  'notification-permission-denied': 'settings.notifications.blocked.notificationPermissionDenied'
};

const toolDownloadLinks: Record<ToolKey, {
  url: string;
  ariaLabel: TranslationKey;
}> = {
  image: {
    url: 'https://github.com/garyzyg/mozjpeg-windows/releases',
    ariaLabel: 'settings.downloadImageAria'
  },
  imagemagick: {
    url: 'https://imagemagick.org/download/',
    ariaLabel: 'settings.downloadImageMagickAria'
  },
  exiftool: {
    url: 'https://exiftool.org/',
    ariaLabel: 'settings.downloadExifToolAria'
  },
  video: {
    url: 'https://handbrake.fr/downloads2.php',
    ariaLabel: 'settings.downloadVideoAria'
  }
};

const SettingsPage = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<EncoderSettingsSnapshot>({
    imageToolCommand: '',
    videoToolCommand: '',
    imageMagickCommand: '',
    exifToolCommand: '',
    updatedAt: 0
  });

  const [savedSettings, setSavedSettings] = useState<EncoderSettingsSnapshot>({
    imageToolCommand: '',
    videoToolCommand: '',
    imageMagickCommand: '',
    exifToolCommand: '',
    updatedAt: 0
  });

  const [statuses, setStatuses] = useState<{
    image: ToolStatus;
    video: ToolStatus;
    imagemagick: ToolStatus;
    exiftool: ToolStatus;
  }>({
    image: 'unknown',
    video: 'unknown',
    imagemagick: 'unknown',
    exiftool: 'unknown'
  });

  const [toolStatusSnapshot, setToolStatusSnapshot] = useState<ToolsStatusSnapshot | null>(null);
  const [isRefreshingTools, setIsRefreshingTools] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [toolPathMessage, setToolPathMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isResettingState, setIsResettingState] = useState(false);
  const [isClearingDestination, setIsClearingDestination] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [notificationSettings, setNotificationSettings] = useState<CompletionNotificationSettings>(
    loadCompletionNotificationSettings
  );
  const [browserPermission, setBrowserPermission] = useState<BrowserPermissionState>(() => getBrowserNotificationPermission());
  const [notificationMessage, setNotificationMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadEncoderSettings().then((loaded) => {
      setSettings(loaded);
      setSavedSettings(loaded);
      void refreshToolStatus(loaded);
    });

    loadFolderSelections().then((selections) => {
      setSourcePath(selections.source?.path ?? '');
      setDestinationPath(selections.destination?.path ?? '');
    });

    setBrowserPermission(getBrowserNotificationPermission());
  }, []);

  const refreshToolStatus = async (nextSettings: EncoderSettingsSnapshot = settings) => {
    setIsRefreshingTools(true);

    try {
      const snapshot = await loadToolsStatusRequest(nextSettings);
      setToolStatusSnapshot(snapshot);
      setStatuses({
        image: snapshot.tools.image.status,
        video: snapshot.tools.video.status,
        imagemagick: snapshot.tools.imagemagick.status,
        exiftool: snapshot.tools.exiftool.status
      });
    } catch (error) {
      setToolPathMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('settings.toolStatusFailed')
      });
    } finally {
      setIsRefreshingTools(false);
    }
  };

  const validatePaths = (nextSettings: EncoderSettingsSnapshot) => {
    const fallbackStatus = (tool: ToolKey) =>
      getEffectiveToolCommand(tool, nextSettings) ? 'unknown' as const : 'missing' as const;

    setStatuses({
      image: fallbackStatus('image'),
      video: fallbackStatus('video'),
      imagemagick: fallbackStatus('imagemagick'),
      exiftool: fallbackStatus('exiftool')
    });
  };

  const getToolField = (tool: ToolKey) => {
    if (tool === 'image') return 'imageToolCommand';
    if (tool === 'video') return 'videoToolCommand';
    if (tool === 'imagemagick') return 'imageMagickCommand';
    return 'exifToolCommand';
  };

  const getToolName = (tool: ToolKey) => {
    const snapshot = toolStatusSnapshot?.tools[tool];

    if (snapshot) {
      return snapshot.effectiveCommand;
    }

    if (!isWindowsPlatform()) {
      return getEffectiveToolCommand(tool, settings);
    }

    if (tool === 'image') return 'cjpeg-static.exe';
    if (tool === 'video') return 'HandBrakeCLI.exe';
    if (tool === 'imagemagick') return 'magick.exe';
    return 'exiftool.exe';
  };

  const getToolLabelKey = (tool: ToolKey): TranslationKey => {
    if (isWindowsPlatform()) {
      if (tool === 'image') return 'settings.imagePathLabel';
      if (tool === 'video') return 'settings.videoPathLabel';
      if (tool === 'imagemagick') return 'settings.imageMagickPathLabel';
      return 'settings.exifToolPathLabel';
    }

    if (tool === 'image') return 'settings.imageCommandLabel';
    if (tool === 'video') return 'settings.videoCommandLabel';
    if (tool === 'imagemagick') return 'settings.imageMagickCommandLabel';
    return 'settings.exifToolCommandLabel';
  };

  const getToolPlaceholder = (tool: ToolKey) => {
    if (!isWindowsPlatform()) {
      return getEffectiveToolCommand(tool, {
        imageToolCommand: '',
        videoToolCommand: '',
        imageMagickCommand: '',
        exifToolCommand: '',
        updatedAt: 0
      });
    }

    if (tool === 'image') return 'C:\\Program Files\\mozjpeg\\cjpeg-static.exe';
    if (tool === 'video') return 'C:\\Program Files\\HandBrake\\HandBrakeCLI.exe';
    if (tool === 'imagemagick') return 'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe';
    return 'C:\\Tools\\exiftool.exe';
  };

  const handlePathChange = (tool: ToolKey, value: string) => {
    const newSettings = {
      ...settings,
      [getToolField(tool)]: value
    };
    setSettings(newSettings);
    validatePaths(newSettings);
    setToolStatusSnapshot(null);
  };

  const handleClearPath = (tool: ToolKey) => {
    handlePathChange(tool, '');
    setToolPathMessage({
      type: 'success',
      text: t('settings.pathCleared', { tool: getToolName(tool) })
    });
  };

  const handleBrowse = async (tool: ToolKey) => {
    try {
      const currentPath = settings[getToolField(tool)];
      const result = await pickFileRequest({
        title:
          tool === 'image'
            ? t('settings.chooseImageExecutable')
            : tool === 'video'
              ? t('settings.chooseVideoExecutable')
              : tool === 'imagemagick'
                ? t('settings.chooseImageMagickExecutable')
                : t('settings.chooseExifToolExecutable'),
        initialPath: currentPath,
        filters: isWindowsPlatform()
          ? [{ name: t('settings.executableFiles'), extensions: ['exe'] }]
          : undefined
      });

      if (result.status === 'cancelled') {
        return;
      }

      if (result.status === 'unsupported') {
        setToolPathMessage({
          type: 'error',
          text: result.message
        });
        return;
      }

      handlePathChange(tool, result.path);
      setToolPathMessage({
        type: 'success',
        text: t('settings.selectedPath', { path: result.path })
      });
    } catch (error) {
      setToolPathMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('settings.filePickerError')
      });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveEncoderSettings({
        imageToolCommand: settings.imageToolCommand,
        videoToolCommand: settings.videoToolCommand,
        imageMagickCommand: settings.imageMagickCommand,
        exifToolCommand: settings.exifToolCommand
      });
      setSavedSettings({
        imageToolCommand: settings.imageToolCommand,
        videoToolCommand: settings.videoToolCommand,
        imageMagickCommand: settings.imageMagickCommand,
        exifToolCommand: settings.exifToolCommand,
        updatedAt: Date.now()
      });
      setSaveMessage({
        type: 'success',
        text: t('settings.saved')
      });
      void refreshToolStatus({
        imageToolCommand: settings.imageToolCommand,
        videoToolCommand: settings.videoToolCommand,
        imageMagickCommand: settings.imageMagickCommand,
        exifToolCommand: settings.exifToolCommand,
        updatedAt: Date.now()
      });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: t('settings.saveFailed', { message: error instanceof Error ? error.message : t('settings.unknownError') })
      });
    } finally {
      setIsSaving(false);
    }
  };

  const hasPendingEncoderChanges =
    settings.imageToolCommand !== savedSettings.imageToolCommand ||
    settings.videoToolCommand !== savedSettings.videoToolCommand ||
    settings.imageMagickCommand !== savedSettings.imageMagickCommand ||
    settings.exifToolCommand !== savedSettings.exifToolCommand;

  const renderDownloadLink = (tool: ToolKey) => {
    if (settings[getToolField(tool)].trim()) {
      return null;
    }

    const downloadLink = toolDownloadLinks[tool];
    const snapshot = toolStatusSnapshot?.tools[tool];

    return (
      <a
        className="path-btn path-btn-download"
        href={snapshot?.installUrl ?? downloadLink.url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={t(downloadLink.ariaLabel)}
        title={t(downloadLink.ariaLabel)}
      >
        {t('settings.download')}
      </a>
    );
  };

  const getToolStatusLabel = (status: ToolStatus) => {
    if (status === 'ready') return t('settings.toolStatus.ready');
    if (status === 'missing') return t('settings.toolStatus.missing');
    return t('settings.toolStatus.unknown');
  };

  const renderToolStatus = (tool: ToolKey) => {
    const status = statuses[tool];
    const snapshot = toolStatusSnapshot?.tools[tool] as ExternalToolStatusSnapshot | undefined;

    return (
      <div className={`status status-${status}`}>
        <span className="status-dot" />
        <span>{getToolStatusLabel(status)}</span>
        {snapshot?.resolvedPath ? (
          <code className="status-path">{snapshot.resolvedPath}</code>
        ) : snapshot ? (
          <code className="status-path">{snapshot.effectiveCommand}</code>
        ) : null}
      </div>
    );
  };

  const renderInstallHint = (tool: ToolKey) => {
    const snapshot = toolStatusSnapshot?.tools[tool];

    if (!snapshot || snapshot.status !== 'missing') {
      return null;
    }

    return (
      <div className="tool-install-hint">
        {snapshot.installCommand ? (
          <p>{t('settings.installCommand', { command: snapshot.installCommand })}</p>
        ) : (
          <p>{t('settings.installFromDownload')}</p>
        )}
        {snapshot.note ? <p>{snapshot.note}</p> : null}
      </div>
    );
  };

  const saveNotificationSettings = (nextSettings: Omit<CompletionNotificationSettings, 'updatedAt'>) => {
    const saved = saveCompletionNotificationSettings(nextSettings);
    setNotificationSettings(saved);
    return saved;
  };

  const updateNotificationChannel = (channel: 'soundEnabled' | 'browserNotificationsEnabled', value: boolean) => {
    saveNotificationSettings({
      ...notificationSettings,
      [channel]: value
    });
  };

  const updateNotificationEvent = (eventKey: CompletionNotificationEventKey, value: boolean) => {
    saveNotificationSettings({
      ...notificationSettings,
      events: {
        ...notificationSettings.events,
        [eventKey]: value
      }
    });
  };

  const handleEnableBrowserNotifications = async () => {
    const permission = await requestBrowserNotificationPermission();
    setBrowserPermission(permission);

    if (permission === 'granted') {
      updateNotificationChannel('browserNotificationsEnabled', true);
      setNotificationMessage({ type: 'success', text: t('settings.notifications.browserEnabled') });
      return;
    }

    updateNotificationChannel('browserNotificationsEnabled', false);
    setNotificationMessage({
      type: 'error',
      text: permission === 'unsupported'
        ? t('settings.notifications.browserUnsupported')
        : t('settings.notifications.browserDenied')
    });
  };

  const handleToggleBrowserNotifications = (enabled: boolean) => {
    if (enabled && browserPermission !== 'granted') {
      void handleEnableBrowserNotifications();
      return;
    }

    updateNotificationChannel('browserNotificationsEnabled', enabled);
  };

  const getTestNotificationMessage = (result: CompletionNotificationResult) => {
    if (result.soundPlayed && result.browserNotificationShown) {
      return t('settings.notifications.testSentBoth');
    }

    if (result.soundPlayed) {
      return t('settings.notifications.testSentSound');
    }

    if (result.browserNotificationShown) {
      return t('settings.notifications.testSentBrowser');
    }

    return result.blockedReason
      ? t(blockedReasonLabelKeys[result.blockedReason])
      : t('settings.notifications.testBlocked');
  };

  const handleTestNotification = async () => {
    if (notificationSettings.browserNotificationsEnabled && browserPermission !== 'granted') {
      const permission = await requestBrowserNotificationPermission();
      setBrowserPermission(permission);

      if (permission !== 'granted' && !notificationSettings.soundEnabled) {
        setNotificationMessage({
          type: 'error',
          text: permission === 'unsupported'
            ? t('settings.notifications.browserUnsupported')
            : t('settings.notifications.browserDenied')
        });
        return;
      }
    }

    const result = await testCompletionNotification({
      title: t('notifications.test.title'),
      body: t('notifications.test.body')
    });

    const wasAnyChannelDelivered = result.soundPlayed || result.browserNotificationShown;

    setNotificationMessage({
      type: wasAnyChannelDelivered ? 'success' : 'error',
      text: getTestNotificationMessage(result)
    });
  };

  const handleResetRuntimeState = async () => {
    setIsResettingState(true);

    try {
      await resetRuntimeStateWithBackend();
      setMaintenanceMessage({
        type: 'success',
        text: t('settings.resetCompleted')
      });
    } catch (error) {
      setMaintenanceMessage({
        type: 'error',
        text: t('settings.resetFailed', { message: error instanceof Error ? error.message : t('settings.unknownError') })
      });
    } finally {
      setIsResettingState(false);
    }
  };

  const handleClearDestination = async () => {
    if (!destinationPath) {
      setMaintenanceMessage({
        type: 'error',
        text: t('settings.noDestination')
      });
      return;
    }

    const confirmed = window.confirm(
      t('settings.clearConfirm', { destinationPath })
    );

    if (!confirmed) {
      return;
    }

    setIsClearingDestination(true);

    try {
      const response = await fetch('/api/system/maintenance/clear-destination', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          destinationPath,
          sourcePath,
          confirmation: 'CLEAR_DESTINATION'
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Request failed with status ${response.status}`);
      }

      const result = (await response.json()) as { deletedEntries?: number };

      resetCompressionSession();

      setMaintenanceMessage({
        type: 'success',
        text: t('settings.destinationCleaned', { count: result.deletedEntries ?? 0 })
      });
    } catch (error) {
      setMaintenanceMessage({
        type: 'error',
        text: t('settings.clearDestinationFailed', { message: error instanceof Error ? error.message : t('settings.unknownError') })
      });
    } finally {
      setIsClearingDestination(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>{t('settings.title')}</h1>
        <p>{t('settings.subtitle')}</p>
      </div>

      <div className="settings-content">
        <div className="settings-card settings-card-encoders">
          <div className="settings-card-heading">
            <div>
              <div className="card-title">{t('settings.encoderTools')}</div>
              <div className="card-subtitle">
                {t('settings.encoderSubtitle')}
              </div>
            </div>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => void refreshToolStatus()}
              disabled={isRefreshingTools}
            >
              {isRefreshingTools ? t('settings.refreshingTools') : t('settings.refreshToolStatus')}
            </button>
          </div>
          <div className="card-subtitle">
            {toolStatusSnapshot?.python.status === 'missing'
              ? t('settings.pythonMissing', { command: toolStatusSnapshot.python.command })
              : toolStatusSnapshot?.python.resolvedPath
                ? t('settings.pythonReady', { path: toolStatusSnapshot.python.resolvedPath })
                : t('settings.toolStatusPrompt')}
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">📸 {t('settings.imageCompression')}</div>
            <div className="card-subtitle">{t('settings.imageSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t(getToolLabelKey('image'))}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.imageToolCommand}
                  onChange={(e) => handlePathChange('image', e.target.value)}
                  placeholder={getToolPlaceholder('image')}
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('image')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
                {renderDownloadLink('image')}
                {settings.imageToolCommand && (
                  <button
                    className="path-btn path-btn-clear"
                    onClick={() => handleClearPath('image')}
                    type="button"
                    aria-label={t('settings.clearImageAria')}
                  >
                    ✕
                  </button>
                )}
              </div>
              {renderToolStatus('image')}
              {renderInstallHint('image')}
            </div>
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">{t('settings.heicConversion')}</div>
            <div className="card-subtitle">{t('settings.heicSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t(getToolLabelKey('imagemagick'))}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.imageMagickCommand}
                  onChange={(e) => handlePathChange('imagemagick', e.target.value)}
                  placeholder={getToolPlaceholder('imagemagick')}
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('imagemagick')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
                {renderDownloadLink('imagemagick')}
                {settings.imageMagickCommand && (
                  <button
                    className="path-btn path-btn-clear"
                    onClick={() => handleClearPath('imagemagick')}
                    type="button"
                    aria-label={t('settings.clearImageMagickAria')}
                  >
                    ✕
                  </button>
                )}
              </div>
              {renderToolStatus('imagemagick')}
              {renderInstallHint('imagemagick')}
            </div>
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">{t('settings.metadataTools')}</div>
            <div className="card-subtitle">{t('settings.metadataSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t(getToolLabelKey('exiftool'))}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.exifToolCommand}
                  onChange={(e) => handlePathChange('exiftool', e.target.value)}
                  placeholder={getToolPlaceholder('exiftool')}
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('exiftool')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
                {renderDownloadLink('exiftool')}
                {settings.exifToolCommand && (
                  <button
                    className="path-btn path-btn-clear"
                    onClick={() => handleClearPath('exiftool')}
                    type="button"
                    aria-label={t('settings.clearExifToolAria')}
                  >
                    ✕
                  </button>
                )}
              </div>
              {renderToolStatus('exiftool')}
              {renderInstallHint('exiftool')}
            </div>
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">🎬 {t('settings.videoCompression')}</div>
            <div className="card-subtitle">{t('settings.videoSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t(getToolLabelKey('video'))}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.videoToolCommand}
                  onChange={(e) => handlePathChange('video', e.target.value)}
                  placeholder={getToolPlaceholder('video')}
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('video')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
                {renderDownloadLink('video')}
                {settings.videoToolCommand && (
                  <button
                    className="path-btn path-btn-clear"
                    onClick={() => handleClearPath('video')}
                    type="button"
                    aria-label={t('settings.clearVideoAria')}
                  >
                    ✕
                  </button>
                )}
              </div>
              {renderToolStatus('video')}
              {renderInstallHint('video')}
            </div>
          </div>

          <div className="encoder-actions-footer">
            <p className="encoder-actions-note">
              {hasPendingEncoderChanges ? t('settings.unsavedChanges') : t('settings.changesLocal')}
            </p>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving || !hasPendingEncoderChanges}
              type="button"
            >
              {isSaving ? t('settings.saving') : t('settings.saveEncoderPaths')}
            </button>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-title">{t('settings.notifications.title')}</div>
          <div className="card-subtitle">{t('settings.notifications.subtitle')}</div>

          <div className="notification-settings-grid">
            <label className="notification-toggle-row">
              <input
                checked={notificationSettings.soundEnabled}
                onChange={(event) => updateNotificationChannel('soundEnabled', event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>{t('settings.notifications.sound')}</strong>
                <small>{t('settings.notifications.soundDescription')}</small>
              </span>
            </label>

            <label className="notification-toggle-row">
              <input
                checked={notificationSettings.browserNotificationsEnabled}
                onChange={(event) => handleToggleBrowserNotifications(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>{t('settings.notifications.browser')}</strong>
                <small>{t('settings.notifications.browserDescription', { permission: t(permissionLabelKeys[browserPermission]) })}</small>
              </span>
            </label>
          </div>

          <div className="notification-actions">
            <button className="btn btn-secondary" type="button" onClick={() => void handleEnableBrowserNotifications()}>
              {t('settings.notifications.requestPermission')}
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void handleTestNotification()}>
              {t('settings.notifications.test')}
            </button>
          </div>

          <div className="notification-event-list">
            {COMPLETION_NOTIFICATION_EVENT_KEYS.map((eventKey) => (
              <label className="notification-event-row" key={eventKey}>
                <input
                  checked={notificationSettings.events[eventKey]}
                  onChange={(event) => updateNotificationEvent(eventKey, event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>{t(notificationEventLabelKeys[eventKey].title)}</strong>
                  <small>{t(notificationEventLabelKeys[eventKey].description)}</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="settings-card">
          <div className="card-title">{t('settings.maintenance')}</div>
          <div className="card-subtitle">{t('settings.maintenanceSubtitle')}</div>

          <div className="maintenance-group">
            <p className="maintenance-note">
              {t('settings.resetNote')}
            </p>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={handleResetRuntimeState}
              disabled={isResettingState || isClearingDestination}
            >
              {isResettingState ? t('settings.resetting') : t('settings.resetRuntime')}
            </button>
          </div>

          <div className="maintenance-group maintenance-danger">
            <p className="maintenance-note">
              {t('settings.destinationCleanupNote')}
            </p>
            <p className="maintenance-path">{t('settings.destinationPath', { path: destinationPath || t('settings.notConfigured') })}</p>
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => void handleClearDestination()}
              disabled={isClearingDestination || isResettingState || !destinationPath}
            >
              {isClearingDestination ? t('settings.clearingDestination') : t('settings.clearDestination')}
            </button>
          </div>
        </div>

        {saveMessage && (
          <div className={`message message-${saveMessage.type}`}>
            {saveMessage.text}
          </div>
        )}

        {toolPathMessage && (
          <div className={`message message-${toolPathMessage.type}`}>
            {toolPathMessage.text}
          </div>
        )}

        {maintenanceMessage && (
          <div className={`message message-${maintenanceMessage.type}`}>
            {maintenanceMessage.text}
          </div>
        )}

        {notificationMessage && (
          <div className={`message message-${notificationMessage.type}`}>
            {notificationMessage.text}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
