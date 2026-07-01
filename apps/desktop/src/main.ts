import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, protocol, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from 'electron';
import { createBackendLifecycle, type BackendHandle, type BackendLifecycleSnapshot } from './backendLifecycle.js';
import { readLogTail, redactDiagnostics } from './diagnostics.js';
import { isTrustedDesktopUrl } from './ipcSecurity.js';
import { createDesktopLogger } from './logging.js';
import { OAuthCallbackBridge } from './oauthBridge.js';
import { registerAppProtocol, unregisterAppProtocol } from './protocol.js';
import { resolveDesktopRuntimePaths } from './runtimePaths.js';

protocol.registerSchemesAsPrivileged([{
  scheme: 'media-organizer',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

app.setName('Media Organizer');
app.setAppUserModelId('com.mediaorganizer.desktop');
if (process.env.MEDIA_ORGANIZER_SMOKE_REPORT) {
  app.disableHardwareAcceleration();
}

let mainWindow: BrowserWindow | null = null;
let backendLifecycle: ReturnType<typeof createBackendLifecycle> | null = null;
let oauthBridge: OAuthCallbackBridge | null = null;
let isQuitting = false;

const summarizeActiveGroupingMedia = (logTail: string) => {
  const active = new Map<string, string>();
  for (const line of logTail.split(/\r?\n/)) {
    const start = line.match(/\[grouping-media\] start request=([^\s]+).*operation=([^\s]+).*file=(".*"|[^\s]+)/);
    if (start) {
      active.set(start[1], `request=${start[1]} operation=${start[2]} file=${start[3]}`);
      continue;
    }
    const finish = line.match(/\[grouping-media\] finish request=([^\s]+)/);
    if (finish) active.delete(finish[1]);
  }

  return [...active.values()].slice(-8);
};

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

const launchBackend = (
  paths: ReturnType<typeof resolveDesktopRuntimePaths>,
  token: string,
  version: string,
  onProcess: (child: UtilityProcess) => void
) =>
  new Promise<BackendHandle>((resolve, reject) => {
    const workerPath = paths.workerPath && fs.existsSync(paths.workerPath) ? paths.workerPath : undefined;
    const child = utilityProcess.fork(paths.backendEntry, [], {
      cwd: paths.workingDirectory,
      env: {
        ...process.env,
        MEDIA_ORGANIZER_DESKTOP: '1',
        MEDIA_ORGANIZER_VERSION: version,
        MEDIA_ORGANIZER_DATA_DIR: paths.dataDir,
        MEDIA_ORGANIZER_MIGRATIONS_DIR: paths.migrationsDir,
        MEDIA_ORGANIZER_DESKTOP_TOKEN: token,
        GOOGLE_PHOTOS_REDIRECT_URI: 'http://localhost:4000/api/export/google-photos/oauth/callback',
        ...(workerPath ? { MEDIA_ORGANIZER_WORKER_PATH: workerPath } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'Media Organizer Backend'
    });

    onProcess(child);
    const timeout = setTimeout(() => reject(new Error('Backend startup timed out.')), 20_000);
    let ready = false;
    let exitResult: { exitCode: number | null; reason?: string } | null = null;
    const exitListeners = new Set<(exit: { exitCode: number | null; reason?: string }) => void>();
    child.on('error', (type, location, report) => {
      const error = new Error(`${type} in ${location}: ${report}`);
      if (!ready) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on('exit', (code) => {
      exitResult = { exitCode: code, reason: 'exit' };
      for (const listener of exitListeners) listener(exitResult);
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`Backend exited during startup (${code ?? 'unknown'}).`));
      }
    });
    child.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const event = message as { type?: string; port?: number; message?: string };
      if (event.type === 'ready' && typeof event.port === 'number') {
        clearTimeout(timeout);
        ready = true;
        resolve({
          port: event.port,
          pid: child.pid ?? null,
          requestShutdown: () => child.postMessage({ type: 'shutdown' }),
          kill: () => child.kill(),
          onExit(listener) {
            if (exitResult) {
              queueMicrotask(() => listener(exitResult!));
              return () => undefined;
            }
            exitListeners.add(listener);
            return () => exitListeners.delete(listener);
          }
        });
      } else if (event.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(event.message || 'Backend failed to start.'));
      }
    });
  });

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f172a',
    icon: path.join(app.getAppPath(), 'apps', 'desktop', 'assets', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(app.getAppPath(), 'apps', 'desktop', 'dist', 'preload.cjs')
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('media-organizer://app/')) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { mainWindow = null; });
  return window;
};

const showStartupError = async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const window = createWindow();
  mainWindow = window;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Media Organizer</title><style>body{font:16px system-ui;background:#0f172a;color:#e2e8f0;padding:48px}main{max-width:720px;margin:auto}pre{white-space:pre-wrap;background:#1e293b;padding:16px;border-radius:8px}</style><main><h1>Media Organizer could not start</h1><p>Close the app and try again. The diagnostic log is stored in your user profile.</p><pre>${message}</pre></main>`)}`);
};

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.focus();
});

app.on('before-quit', () => {
  isQuitting = true;
  oauthBridge?.stop();
  unregisterAppProtocol();
  void backendLifecycle?.stop();
});

app.on('window-all-closed', () => {
  if (!isQuitting) app.quit();
});

void app.whenReady().then(async () => {
  const paths = resolveDesktopRuntimePaths(app);
  const logger = createDesktopLogger(paths.logsDir);
  app.once('will-quit', logger.close);
  logger.write('desktop', `Media Organizer ${app.getVersion()} starting on ${process.platform}/${process.arch}.`);
  process.on('uncaughtExceptionMonitor', (error, origin) => logger.write(`main:${origin}`, error.stack ?? error.message));
  app.on('child-process-gone', (_event, details) => logger.write('electron:child-process-gone', JSON.stringify(details)));
  app.on('render-process-gone', (_event, _contents, details) => logger.write('electron:render-process-gone', JSON.stringify(details)));

  try {
    const token = randomBytes(32).toString('hex');
    backendLifecycle = createBackendLifecycle({
      launch: () => launchBackend(paths, token, app.getVersion(), (child) => {
        logger.pipe('backend:out', child.stdout as NodeJS.ReadableStream | null);
        logger.pipe('backend:err', child.stderr as NodeJS.ReadableStream | null);
        child.on('error', (type, location, report) => logger.write('backend:fatal', `${type} in ${location}: ${report}`));
      }),
      log: (message) => logger.write('backend:lifecycle', message)
    });
    await backendLifecycle.start();

    const requireTrustedIpc = (event: IpcMainInvokeEvent) => {
      if (!event.senderFrame || !isTrustedDesktopUrl(event.senderFrame.url)) throw new Error('Desktop diagnostics are only available to the packaged application.');
    };
    const broadcastState = (state: BackendLifecycleSnapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:backend-state-changed', state);
    };
    backendLifecycle.subscribe(broadcastState);
    ipcMain.handle('desktop:backend-state', (event) => {
      requireTrustedIpc(event);
      return backendLifecycle!.getSnapshot();
    });
    ipcMain.handle('desktop:restart-backend', async (event) => {
      requireTrustedIpc(event);
      return await backendLifecycle!.restart();
    });
    ipcMain.handle('desktop:open-logs', async (event) => {
      requireTrustedIpc(event);
      const message = await shell.openPath(paths.logsDir);
      return message ? { ok: false, message } : { ok: true };
    });
    ipcMain.handle('desktop:copy-diagnostics', (event) => {
      requireTrustedIpc(event);
      const state = backendLifecycle!.getSnapshot();
      const report = [
        'Media Organizer desktop diagnostics',
        `Generated: ${new Date().toISOString()}`,
        `Version: ${app.getVersion()}`,
        `Platform: ${process.platform}/${process.arch}`,
        `Backend state: ${state.status}`,
        `Incident: ${state.incident ? JSON.stringify(state.incident) : 'none'}`,
        `Log file: ${logger.filePath}`,
        '',
        'Recent log:',
        logger.getTail() || readLogTail(logger.filePath)
      ].join('\n');
      clipboard.writeText(redactDiagnostics(report, app.getPath('home'), token));
      logger.write('desktop', 'Diagnostic summary copied to clipboard.');
      return { ok: true };
    });
    ipcMain.handle('desktop:report-backend-unresponsive', (event) => {
      requireTrustedIpc(event);
      const activeGroupingMedia = summarizeActiveGroupingMedia(logger.getTail());
      const details = activeGroupingMedia.length > 0
        ? `Active grouping media operations: ${activeGroupingMedia.join(' | ')}`
        : 'No active grouping media operations were found in the recent log tail.';
      logger.write('renderer:health', `Backend health remained offline for at least 30000ms while the process was still running. ${details}`);
      backendLifecycle!.reportUnresponsive(details);
      broadcastState(backendLifecycle!.getSnapshot());
    });

    oauthBridge = new OAuthCallbackBridge(() => {
      const port = backendLifecycle!.getPort();
      if (port === null) throw new Error('The backend is offline. Restart it before signing in.');
      return { port, token };
    });
    registerAppProtocol({
      webRoot: paths.webRoot,
      getBackendPort: () => backendLifecycle!.getPort(),
      token,
      beforeOAuthStart: () => oauthBridge!.start(),
      onError: (error) => logger.write('protocol', error instanceof Error ? error.stack ?? error.message : String(error))
    });

    mainWindow = createWindow();
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        logger.write(level === 3 ? 'renderer:error' : 'renderer:warning', `${message} (${sourceId}:${line})`);
      }
    });
    await mainWindow.loadURL('media-organizer://app/');
    broadcastState(backendLifecycle.getSnapshot());

    const smokeReport = process.env.MEDIA_ORGANIZER_SMOKE_REPORT?.trim();
    if (smokeReport) {
      const expectedMarker = process.env.MEDIA_ORGANIZER_SMOKE_EXPECT?.trim() || null;
      const marker = process.env.MEDIA_ORGANIZER_SMOKE_VALUE?.trim() || 'desktop-smoke-marker';
      const result = await mainWindow.webContents.executeJavaScript(`(async () => {
        const previous = localStorage.getItem('media-organizer:desktop-smoke');
        localStorage.setItem('media-organizer:desktop-smoke', ${JSON.stringify(marker)});
        const response = await fetch('/api/system/runtime');
        const bridge = window.mediaOrganizerDesktop;
        const backendState = bridge ? await bridge.getBackendState() : null;
        return {
          previous,
          runtime: await response.json(),
          status: response.status,
          rendered: Boolean(document.querySelector('#root')?.childElementCount),
          bridgeAvailable: Boolean(bridge),
          backendState
        };
      })()`);
      fs.writeFileSync(smokeReport, JSON.stringify({ ...result, expectedMarker }, null, 2));
      if (expectedMarker && result.previous !== expectedMarker) process.exitCode = 1;
      app.quit();
    }
  } catch (error) {
    logger.write('desktop', error instanceof Error ? error.stack ?? error.message : String(error));
    await showStartupError(error);
  }
});
