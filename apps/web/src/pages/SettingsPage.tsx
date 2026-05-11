import { useEffect, useState } from 'react';
import {
  loadEncoderSettings,
  saveEncoderSettings,
  type EncoderSettingsSnapshot
} from '../services/encoder-settings.store';
import { resetCompressionJob } from '../services/compression-job.store';
import {
  clearSourceSelectionScope,
  clearSourceTreeSnapshot,
  loadFolderSelections
} from '../services/folder-selection.store';
import '../styles/SettingsPage.css';

type ToolStatus = 'ready' | 'missing' | 'unknown';

const SettingsPage = () => {
  const [settings, setSettings] = useState<EncoderSettingsSnapshot>({
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

  const resolveToolPath = async (candidate: string) => {
    const response = await fetch('/api/system/maintenance/resolve-command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ command: candidate })
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { resolvedPath?: string | null };
    return payload.resolvedPath ?? null;
  };

  const handleBrowse = (tool: 'image' | 'video') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.exe';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const fileWithPath = file as File & { path?: string };
        const rawPath = (typeof fileWithPath.path === 'string' && fileWithPath.path.trim().length > 0)
          ? fileWithPath.path.trim()
          : file.name;

        const resolvedPath = await resolveToolPath(rawPath);
        const nextPath = resolvedPath ?? rawPath;

        handlePathChange(tool, nextPath);

        if (resolvedPath) {
          setToolPathMessage({
            type: 'success',
            text: `Resolved full path: ${resolvedPath}`
          });
        } else if (!rawPath.includes('\\') && !rawPath.includes('/')) {
          setToolPathMessage({
            type: 'error',
            text: 'Browser returned only the file name. Paste an absolute path manually if this command is not in PATH.'
          });
        } else {
          setToolPathMessage({
            type: 'success',
            text: `Selected path: ${nextPath}`
          });
        }
      }
    };
    input.click();
  };

  const handleSave = async () => {
    if (!settings.imageToolCommand || !settings.videoToolCommand) {
      setSaveMessage({
        type: 'error',
        text: 'Please configure both encoder paths before saving'
      });
      return;
    }

    setIsSaving(true);
    try {
      await saveEncoderSettings({
        imageToolCommand: settings.imageToolCommand,
        videoToolCommand: settings.videoToolCommand
      });
      setSaveMessage({
        type: 'success',
        text: 'Encoder settings saved successfully'
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

  const handleResetRuntimeState = () => {
    setIsResettingState(true);

    try {
      resetCompressionJob();
      clearSourceSelectionScope();
      clearSourceTreeSnapshot('source');
      clearSourceTreeSnapshot('destination');

      setMaintenanceMessage({
        type: 'success',
        text: 'Runtime state reset. Compression status and cached source scope were cleared.'
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

      resetCompressionJob();

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
        <div className="settings-card">
          <div className="card-title">📸 Image Compression (mozjpeg)</div>
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
                onClick={() => handleBrowse('image')}
                type="button"
              >
                Browse…
              </button>
            </div>
            {statuses.image === 'ready' && (
              <div className="status status-ready">
                <span className="status-dot"></span>
                <span>✓ Configured</span>
              </div>
            )}
            {statuses.image === 'missing' && (
              <div className="status status-missing">
                <span className="status-dot"></span>
                <span>✗ Not configured</span>
              </div>
            )}
          </div>
        </div>

        <div className="settings-card">
          <div className="card-title">🎬 Video Compression (HandBrake)</div>
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
                onClick={() => handleBrowse('video')}
                type="button"
              >
                Browse…
              </button>
            </div>
            {statuses.video === 'ready' && (
              <div className="status status-ready">
                <span className="status-dot"></span>
                <span>✓ Configured</span>
              </div>
            )}
            {statuses.video === 'missing' && (
              <div className="status status-missing">
                <span className="status-dot"></span>
                <span>✗ Not configured</span>
              </div>
            )}
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

        <div className="button-group">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving || !settings.imageToolCommand || !settings.videoToolCommand}
            type="button"
          >
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
