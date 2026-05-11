import { useEffect, useState } from 'react';
import {
  loadEncoderSettings,
  saveEncoderSettings,
  type EncoderSettingsSnapshot
} from '../services/encoder-settings.store';
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

  useEffect(() => {
    loadEncoderSettings().then((loaded) => {
      setSettings(loaded);
      // Validate paths
      validatePaths(loaded.imageToolCommand, loaded.videoToolCommand);
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

  const handleBrowse = (tool: 'image' | 'video') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.exe';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const path = (file as any).path || file.name;
        handlePathChange(tool, path);
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
                placeholder="C:\Program Files\mozjpeg\cjpeg-static.exe"
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
                placeholder="C:\Program Files\HandBrake\HandBrakeCLI.exe"
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

        {saveMessage && (
          <div className={`message message-${saveMessage.type}`}>
            {saveMessage.text}
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
