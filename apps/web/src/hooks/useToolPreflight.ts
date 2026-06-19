import { useCallback, useEffect, useState } from 'react';
import {
  loadEncoderSettings,
  subscribeToEncoderSettingsChanges,
  type EncoderSettingsSnapshot
} from '../services/encoder-settings.store';
import { loadToolsStatusRequest, type ToolsStatusSnapshot } from '../services/tool-status.service';

const emptySettings: EncoderSettingsSnapshot = {
  imageToolCommand: '',
  videoToolCommand: '',
  imageMagickCommand: '',
  exifToolCommand: '',
  updatedAt: 0
};

export type ToolPreflightState = {
  status: 'loading' | 'ready' | 'error';
  settings: EncoderSettingsSnapshot;
  snapshot: ToolsStatusSnapshot | null;
  error: string | null;
  refresh: () => Promise<ToolsStatusSnapshot | null>;
};

export const useToolPreflight = (): ToolPreflightState => {
  const [settings, setSettings] = useState(emptySettings);
  const [snapshot, setSnapshot] = useState<ToolsStatusSnapshot | null>(null);
  const [status, setStatus] = useState<ToolPreflightState['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async (nextSettings: EncoderSettingsSnapshot) => {
    setStatus('loading');
    try {
      const nextSnapshot = await loadToolsStatusRequest(nextSettings);
      setSettings(nextSettings);
      setSnapshot(nextSnapshot);
      setError(null);
      setStatus('ready');
      return nextSnapshot;
    } catch (loadError) {
      setSettings(nextSettings);
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not verify media tools.');
      setStatus('error');
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const nextSettings = await loadEncoderSettings();
    return loadSnapshot(nextSettings);
  }, [loadSnapshot]);

  useEffect(() => {
    let active = true;
    void loadEncoderSettings().then((loaded) => {
      if (active) void loadSnapshot(loaded);
    });
    const unsubscribe = subscribeToEncoderSettingsChanges((nextSettings) => {
      if (active) void loadSnapshot(nextSettings);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadSnapshot]);

  return { status, settings, snapshot, error, refresh };
};
