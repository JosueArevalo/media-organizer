import type { BackendHealthStatus } from './backend-health.service';
import type { DesktopBackendStatus } from './desktop-runtime.service';

export const shouldDelayBackendRecovery = (
  healthStatus: BackendHealthStatus,
  desktopStatus: DesktopBackendStatus | null
) => healthStatus === 'offline' && desktopStatus !== 'offline';
