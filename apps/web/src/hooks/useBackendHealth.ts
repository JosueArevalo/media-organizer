import { useEffect, useState } from 'react';
import {
  checkBackendHealth,
  mergeBackendHealthSnapshot,
  type BackendHealthSnapshot
} from '../services/backend-health.service';

const createInitialSnapshot = (): BackendHealthSnapshot => ({
  status: 'checking',
  lastOkAt: null,
  lastCheckedAt: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  failureKind: null,
  errorMessage: null
});

export const useBackendHealth = (intervalMs = 1000) => {
  const [snapshot, setSnapshot] = useState<BackendHealthSnapshot>(createInitialSnapshot);

  useEffect(() => {
    let isActive = true;
    let timeoutId: number | null = null;

    const probe = async () => {
      const result = await checkBackendHealth();

      if (!isActive) {
        return;
      }

      setSnapshot((current) => mergeBackendHealthSnapshot(current, result));

      timeoutId = window.setTimeout(() => {
        void probe();
      }, intervalMs);
    };

    void probe();

    return () => {
      isActive = false;

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [intervalMs]);

  return snapshot;
};
