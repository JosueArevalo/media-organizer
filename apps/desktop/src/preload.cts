import { contextBridge, ipcRenderer } from 'electron';
import type { BackendLifecycleSnapshot } from './backendLifecycle.js';

contextBridge.exposeInMainWorld('mediaOrganizerDesktop', {
  getBackendState: (): Promise<BackendLifecycleSnapshot> => ipcRenderer.invoke('desktop:backend-state'),
  restartBackend: (): Promise<BackendLifecycleSnapshot> => ipcRenderer.invoke('desktop:restart-backend'),
  openLogsFolder: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('desktop:open-logs'),
  copyDiagnostics: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('desktop:copy-diagnostics'),
  reportBackendUnresponsive: (): Promise<void> => ipcRenderer.invoke('desktop:report-backend-unresponsive'),
  onBackendState: (listener: (state: BackendLifecycleSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: BackendLifecycleSnapshot) => listener(state);
    ipcRenderer.on('desktop:backend-state-changed', handler);
    return () => ipcRenderer.removeListener('desktop:backend-state-changed', handler);
  }
});
