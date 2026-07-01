export type DesktopBackendStatus = 'starting' | 'online' | 'offline' | 'restarting';

export type DesktopBackendState = {
  status: DesktopBackendStatus;
  incident: {
    occurredAt: string;
    message: string;
    exitCode: number | null;
    reason: string;
    details?: string;
  } | null;
};

type DesktopBridge = {
  getBackendState: () => Promise<DesktopBackendState>;
  restartBackend: () => Promise<DesktopBackendState>;
  openLogsFolder: () => Promise<{ ok: boolean; message?: string }>;
  copyDiagnostics: () => Promise<{ ok: boolean }>;
  reportBackendUnresponsive: () => Promise<void>;
  onBackendState: (listener: (state: DesktopBackendState) => void) => () => void;
};

export const getDesktopBridge = () =>
  (globalThis as typeof globalThis & { mediaOrganizerDesktop?: DesktopBridge }).mediaOrganizerDesktop ?? null;
