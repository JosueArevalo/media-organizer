import { useEffect, useMemo, useRef, useState } from 'react';
import type { BackendHealthStatus } from '../services/backend-health.service';
import { getDesktopBridge, type DesktopBackendState } from '../services/desktop-runtime.service';
import { shouldDelayBackendRecovery } from '../services/backend-recovery.service';

export const SUSTAINED_OFFLINE_DELAY_MS = 30_000;

export const useDesktopBackendRecovery = (healthStatus: BackendHealthStatus) => {
  const bridge = useMemo(getDesktopBridge, []);
  const [state, setState] = useState<DesktopBackendState | null>(null);
  const [isSustainedOffline, setIsSustainedOffline] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const offlineTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getBackendState().then(setState).catch(() => undefined);
    return bridge.onBackendState(setState);
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !shouldDelayBackendRecovery(healthStatus, state?.status ?? null)) {
      if (offlineTimer.current !== null) window.clearTimeout(offlineTimer.current);
      offlineTimer.current = null;
      setIsSustainedOffline(false);
      return;
    }

    if (offlineTimer.current === null) {
      offlineTimer.current = window.setTimeout(() => {
        offlineTimer.current = null;
        setIsSustainedOffline(true);
        void bridge.reportBackendUnresponsive().catch(() => undefined);
      }, SUSTAINED_OFFLINE_DELAY_MS);
    }

    return () => {
      if (offlineTimer.current !== null) window.clearTimeout(offlineTimer.current);
      offlineTimer.current = null;
    };
  }, [bridge, healthStatus, state?.status]);

  const restart = async () => {
    if (!bridge) return;
    setActionMessage(null);
    try {
      setState(await bridge.restartBackend());
      setIsSustainedOffline(false);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openLogs = async () => {
    if (!bridge) return;
    const result = await bridge.openLogsFolder();
    setActionMessage(result.ok ? null : result.message ?? 'Could not open the logs folder.');
  };

  const copyDiagnostics = async () => {
    if (!bridge) return;
    await bridge.copyDiagnostics();
    setActionMessage('copied');
  };

  return {
    isDesktop: Boolean(bridge),
    state,
    shouldShowRecovery: state?.status === 'offline' || state?.status === 'restarting' || isSustainedOffline,
    isRestarting: state?.status === 'restarting' || state?.status === 'starting',
    actionMessage,
    restart,
    openLogs,
    copyDiagnostics
  };
};
