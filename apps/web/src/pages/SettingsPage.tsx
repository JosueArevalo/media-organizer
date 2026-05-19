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
import '../styles/SettingsPage.css';

type ToolStatus = 'ready' | 'missing' | 'unknown';

const SettingsPage = () => {
  const [settings, setSettings] = useState<EncoderSettingsSnapshot>({
    imageToolCommand: '',
    videoToolCommand: '',
    updatedAt: 0
  });

  const [savedSettings, setSavedSettings] = useState<EncoderSettingsSnapshot>({
    imageToolCommand: '',
    videoToolCommand: '',
    updatedAt: 0
  });

  const [statuses, setStatuses] = useState<{
    image: ToolStatus;
    video: ToolStatus;
  }>({
    image: 'unknown',
    video: 'unknown'
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
      validatePaths(loaded.imageToolCommand, loaded.videoToolCommand);
    });

    loadFolderSelections().then((selections) => {
      setSourcePath(selections.source?.path ?? '');
      setDestinationPath(selections.destination?.path ?? '');
    });
  }, []);

  const validatePaths = async (imagePath: string, videoPath: string) => {
    // In a real app, we'd validate against the filesystem
    // For now, we show status based on whether paths are set
    setStatuses({
      image: imagePath ? 'ready' : 'missing',
      video: videoPath ? 'ready' : 'missing'
    });
  };

  const handlePathChange = (tool: 'image' | 'video', value: string) => {
    const newSettings = {
      ...settings,
      [tool === 'image' ? 'imageToolCommand' : 'videoToolCommand']: value
    };
    setSettings(newSettings);
    validatePaths(
      tool === 'image' ? value : settings.imageToolCommand,
      tool === 'video' ? value : settings.videoToolCommand
    );
  };

  const handleClearPath = (tool: 'image' | 'video') => {
    handlePathChange(tool, '');
    setToolPathMessage({
      type: 'success',
      text: `${tool === 'image' ? 'cjpeg-static.exe' : 'HandBrakeCLI.exe'} path cleared locally. Press Save Encoder Paths to apply it.`
    });
  };

  const handleBrowse = async (tool: 'image' | 'video') => {
    try {
      const isWindows = navigator.platform.toLowerCase().includes('win');
      const currentPath = tool === 'image' ? settings.imageToolCommand : settings.videoToolCommand;
      const result = await pickFileRequest({
        title: tool === 'image' ? 'Choose cjpeg-static executable' : 'Choose HandBrakeCLI executable',
        initialPath: currentPath,
        filters: isWindows
          ? [{ name: 'Executable files', extensions: ['exe'] }]
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
        text: `Selected path: ${result.path}. Press Save Encoder Paths to apply it.`
      });
    } catch (error) {
      setToolPathMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not open the file picker.'
      });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveEncoderSettings({
        imageToolCommand: settings.imageToolCommand,
        videoToolCommand: settings.videoToolCommand
      });
      setSavedSettings({
        imageToolCommand: settings.imageToolCommand,
        videoToolCommand: settings.videoToolCommand,
        updatedAt: Date.now()
      });
      setSaveMessage({
        type: 'success',
        text: settings.imageToolCommand && settings.videoToolCommand
          ? 'Encoder settings saved successfully.'
          : 'Encoder settings saved. Compression will remain blocked until both paths are configured.'
      });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      setSaveMessage({
        type: 'error',
        text: `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsSaving(false);
    }
  };

  const hasPendingEncoderChanges =
    settings.imageToolCommand !== savedSettings.imageToolCommand ||
    settings.videoToolCommand !== savedSettings.videoToolCommand;

  const handleResetRuntimeState = async () => {
    setIsResettingState(true);

    try {
      await resetAllPersistentAppState();

      const response = await fetch('/api/system/maintenance/reset-persistent-state', {
        method: 'POST'
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Request failed with status ${response.status}`);
      }

      setMaintenanceMessage({
        type: 'success',
        text: 'Reset completed. Cleared: Source/Destination selections, source tree cache, scope cache, compression session snapshot, theme, IndexedDB folder cache, and backend session history. Encoder paths were preserved.'
      });
    } catch (error) {
      setMaintenanceMessage({
        type: 'error',
        text: `Could not reset runtime state: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsResettingState(false);
    }
  };

  const handleClearDestination = async () => {
    if (!destinationPath) {
      setMaintenanceMessage({
        type: 'error',
        text: 'No destination folder is configured. Go to Import and select a destination first.'
      });
      return;
    }

    const confirmed = window.confirm(
      `This will remove all files and subfolders inside Destination.\n\nDestination:\n${destinationPath}\n\nContinue?`
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
          sourcePath
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
        text: `Destination cleaned (${result.deletedEntries ?? 0} entries removed). Compression state was reset.`
      });
    } catch (error) {
      setMaintenanceMessage({
        type: 'error',
        text: `Could not clear destination: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setIsClearingDestination(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>External Tools Configuration</h1>
        <p>Configure the paths to image and video compression tools on your system.</p>
      </div>

      <div className="settings-content">
        <div className="settings-card settings-card-encoders">
          <div className="card-title">Encoder Tools</div>
          <div className="card-subtitle">
            Configure the external tools used by compression. Save only applies to these paths.
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">📸 Image Compression (mozjpeg)</div>
            <div className="card-subtitle">Required for JPEG optimization using cjpeg</div>

            <div className="form-group">
              <label className="form-label">cjpeg-static.exe path</label>
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
                  Browse
                </button>
                {settings.imageToolCommand && (
                  <button
                    className="path-btn path-btn-clear"
                    onClick={() => handleClearPath('image')}
                    type="button"
                    aria-label="Clear image encoder path"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="settings-card-encoder-block">
            <div className="card-title card-title-compact">🎬 Video Compression (HandBrake)</div>
            <div className="card-subtitle">Required for video re-encoding</div>

            <div className="form-group">
              <label className="form-label">HandBrakeCLI.exe path</label>
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
                  Browse
                </button>
                {settings.videoToolCommand && (
                  <button
                    className="path-btn path-btn-clear"
                    onClick={() => handleClearPath('video')}
                    type="button"
                    aria-label="Clear video encoder path"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="encoder-actions-footer">
            <p className="encoder-actions-note">
              Changes stay local to this screen until you save them.
            </p>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving || !hasPendingEncoderChanges}
              type="button"
            >
              {isSaving ? 'Saving...' : 'Save Encoder Paths'}
            </button>
          </div>
        </div>

        <div className="settings-card">
          <div className="card-title">Maintenance</div>
          <div className="card-subtitle">Recover from stale UI state and clean generated outputs safely.</div>

          <div className="maintenance-group">
            <p className="maintenance-note">
              Reset runtime state clears app cache for compression status and source-scope snapshots.
            </p>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={handleResetRuntimeState}
              disabled={isResettingState || isClearingDestination}
            >
              {isResettingState ? 'Resetting...' : 'Reset Runtime State'}
            </button>
          </div>

          <div className="maintenance-group maintenance-danger">
            <p className="maintenance-note">
              Destination cleanup removes everything inside the current Destination folder but never touches Source.
            </p>
            <p className="maintenance-path">Destination: {destinationPath || 'Not configured'}</p>
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => void handleClearDestination()}
              disabled={isClearingDestination || isResettingState || !destinationPath}
            >
              {isClearingDestination ? 'Clearing Destination...' : 'Clear Destination Contents'}
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
