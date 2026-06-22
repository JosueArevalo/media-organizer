import path from 'node:path';
import type { App } from 'electron';

export type DesktopRuntimePaths = {
  backendEntry: string;
  workingDirectory: string;
  dataDir: string;
  logsDir: string;
  migrationsDir: string;
  webRoot: string;
  workerPath: string | null;
};

export const resolveDesktopRuntimePaths = (
  app: Pick<App, 'getAppPath' | 'getPath' | 'isPackaged'>,
  resourcesPath = process.resourcesPath
): DesktopRuntimePaths => {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');

  if (app.isPackaged) {
    return {
      backendEntry: path.join(resourcesPath, 'backend', 'dist', 'desktop.js'),
      workingDirectory: resourcesPath,
      dataDir: path.join(userData, 'data'),
      logsDir: path.join(userData, 'logs'),
      migrationsDir: path.join(resourcesPath, 'migrations'),
      webRoot: path.join(resourcesPath, 'web'),
      workerPath: path.join(resourcesPath, 'worker', 'media-organizer-worker', 'media-organizer-worker.exe')
    };
  }

  return {
    backendEntry: path.join(appRoot, 'apps', 'backend', 'dist', 'desktop.js'),
    workingDirectory: appRoot,
    dataDir: path.join(userData, 'data'),
    logsDir: path.join(userData, 'logs'),
    migrationsDir: path.join(appRoot, 'apps', 'backend', 'src', 'state', 'migrations'),
    webRoot: path.join(appRoot, 'apps', 'web', 'dist'),
    workerPath: null
  };
};
