import { useEffect, useState } from 'react';
import {
  loadEncoderSettings,
  saveEncoderSettings,
  type EncoderSettingsSnapshot
} from '../services/encoder-settings.store';
import { loadFolderSelections } from '../services/folder-selection.store';
import { resetAllPersistentAppState } from '../services/app-maintenance.store';
import { resetCompressionSession } from '../services/compression-job.store';
import { pickFileRequest } from '../services/system-picker.service';
import { useTranslation } from '../i18n';
import '../styles/SettingsPage.css';

type ToolStatus = 'ready' | 'missing' | 'unknown';
type ToolKey = 'image' | 'video' | 'imagemagick' | 'exiftool';

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

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [toolPathMessage, setToolPathMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isResettingState, setIsResettingState] = useState(false);
  const [isClearingDestination, setIsClearingDestination] = useState(false);
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');

  useEffect(() => {
    loadEncoderSettings().then((loaded) => {
      setSettings(loaded);
      setSavedSettings(loaded);
      // Validate paths
      validatePaths(loaded);
    });

    loadFolderSelections().then((selections) => {
      setSourcePath(selections.source?.path ?? '');
      setDestinationPath(selections.destination?.path ?? '');
    });
  }, []);

  const validatePaths = async (nextSettings: EncoderSettingsSnapshot) => {
    // In a real app, we'd validate against the filesystem
    // For now, we show status based on whether paths are set
    setStatuses({
      image: nextSettings.imageToolCommand ? 'ready' : 'missing',
      video: nextSettings.videoToolCommand ? 'ready' : 'missing',
      imagemagick: nextSettings.imageMagickCommand ? 'ready' : 'missing',
      exiftool: nextSettings.exifToolCommand ? 'ready' : 'missing'
    });
  };

  const getToolField = (tool: ToolKey) => {
    if (tool === 'image') return 'imageToolCommand';
    if (tool === 'video') return 'videoToolCommand';
    if (tool === 'imagemagick') return 'imageMagickCommand';
    return 'exifToolCommand';
  };

  const getToolName = (tool: ToolKey) => {
    if (tool === 'image') return 'cjpeg-static.exe';
    if (tool === 'video') return 'HandBrakeCLI.exe';
    if (tool === 'imagemagick') return 'magick.exe';
    return 'exiftool.exe';
  };

  const handlePathChange = (tool: ToolKey, value: string) => {
    const newSettings = {
      ...settings,
      [getToolField(tool)]: value
    };
    setSettings(newSettings);
    validatePaths(newSettings);
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
      const isWindows = navigator.platform.toLowerCase().includes('win');
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
        filters: isWindows
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

  const handleResetRuntimeState = async () => {
    setIsResettingState(true);

    try {
      await resetAllPersistentAppState();

      const response = await fetch('/api/system/maintenance/reset-persistent-state', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          confirmation: 'RESET_STATE'
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Request failed with status ${response.status}`);
      }

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
          <div className="card-title">{t('settings.encoderTools')}</div>
          <div className="card-subtitle">
            {t('settings.encoderSubtitle')}
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">📸 {t('settings.imageCompression')}</div>
            <div className="card-subtitle">{t('settings.imageSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t('settings.imagePathLabel')}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.imageToolCommand}
                  onChange={(e) => handlePathChange('image', e.target.value)}
                  placeholder="C:\\Program Files\\mozjpeg\\cjpeg-static.exe"
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('image')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
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
            </div>
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">{t('settings.heicConversion')}</div>
            <div className="card-subtitle">{t('settings.heicSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t('settings.imageMagickPathLabel')}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.imageMagickCommand}
                  onChange={(e) => handlePathChange('imagemagick', e.target.value)}
                  placeholder="C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe"
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('imagemagick')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
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
            </div>
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">{t('settings.metadataTools')}</div>
            <div className="card-subtitle">{t('settings.metadataSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t('settings.exifToolPathLabel')}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.exifToolCommand}
                  onChange={(e) => handlePathChange('exiftool', e.target.value)}
                  placeholder="C:\\Tools\\exiftool.exe"
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('exiftool')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
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
            </div>
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">🎬 {t('settings.videoCompression')}</div>
            <div className="card-subtitle">{t('settings.videoSubtitle')}</div>

            <div className="form-group">
              <label className="form-label">{t('settings.videoPathLabel')}</label>
              <div className="path-input-group">
                <input
                  type="text"
                  className="path-input"
                  value={settings.videoToolCommand}
                  onChange={(e) => handlePathChange('video', e.target.value)}
                  placeholder="C:\\Program Files\\HandBrake\\HandBrakeCLI.exe"
                />
                <button
                  className="path-btn"
                  onClick={() => void handleBrowse('video')}
                  type="button"
                >
                  {t('settings.browse')}
                </button>
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
            </div>
          </div>

          <div className="encoder-actions-footer">
            <p className="encoder-actions-note">
              {t('settings.changesLocal')}
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
      </div>
    </div>
  );
};

export default SettingsPage;
