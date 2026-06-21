import path from 'node:path';
import type { App } from 'electron';

export type DesktopRuntimePaths = {
  backendEntry: string;
  dataDir: string;
  logsDir: string;
  migrationsDir: string;
  webRoot: string;
  workerPath: string | null;
};

export const resolveDesktopRuntimePaths = (app: Pick<App, 'getAppPath' | 'getPath' | 'isPackaged'>): DesktopRuntimePaths => {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');

  if (app.isPackaged) {
    return {
      backendEntry: path.join(appRoot, 'apps', 'backend', 'dist', 'desktop.js'),
      dataDir: path.join(userData, 'data'),
      logsDir: path.join(userData, 'logs'),
      migrationsDir: path.join(process.resourcesPath, 'migrations'),
      webRoot: path.join(process.resourcesPath, 'web'),
      workerPath: path.join(process.resourcesPath, 'worker', 'media-organizer-worker', 'media-organizer-worker.exe')
    };
  }

  return {
    backendEntry: path.join(appRoot, 'apps', 'backend', 'dist', 'desktop.js'),
    dataDir: path.join(userData, 'data'),
    logsDir: path.join(userData, 'logs'),
    migrationsDir: path.join(appRoot, 'apps', 'backend', 'src', 'state', 'migrations'),
    webRoot: path.join(appRoot, 'apps', 'web', 'dist'),
    workerPath: null
  };
};
