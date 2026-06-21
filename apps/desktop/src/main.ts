import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, protocol, shell } from 'electron';
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

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let oauthBridge: OAuthCallbackBridge | null = null;
let isQuitting = false;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

const startBackend = (paths: ReturnType<typeof resolveDesktopRuntimePaths>, token: string, version: string) =>
  new Promise<number>((resolve, reject) => {
    const workerPath = paths.workerPath && fs.existsSync(paths.workerPath) ? paths.workerPath : undefined;
    const child = fork(paths.backendEntry, [], {
      execPath: process.execPath,
      cwd: app.getAppPath(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MEDIA_ORGANIZER_DESKTOP: '1',
        MEDIA_ORGANIZER_VERSION: version,
        MEDIA_ORGANIZER_DATA_DIR: paths.dataDir,
        MEDIA_ORGANIZER_MIGRATIONS_DIR: paths.migrationsDir,
        MEDIA_ORGANIZER_DESKTOP_TOKEN: token,
        GOOGLE_PHOTOS_REDIRECT_URI: 'http://localhost:4000/api/export/google-photos/oauth/callback',
        ...(workerPath ? { MEDIA_ORGANIZER_WORKER_PATH: workerPath } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    backendProcess = child;
    const timeout = setTimeout(() => reject(new Error('Backend startup timed out.')), 20_000);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Backend exited during startup (${code ?? 'unknown'}).`)));
    child.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const event = message as { type?: string; port?: number; message?: string };
      if (event.type === 'ready' && typeof event.port === 'number') {
        clearTimeout(timeout);
        resolve(event.port);
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
      sandbox: true
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
  if (backendProcess?.connected) backendProcess.send({ type: 'shutdown' });
  const child = backendProcess;
  setTimeout(() => child?.kill(), 5000).unref();
});

app.on('window-all-closed', () => {
  if (!isQuitting) app.quit();
});

void app.whenReady().then(async () => {
  const paths = resolveDesktopRuntimePaths(app);
  const logger = createDesktopLogger(paths.logsDir);
  app.once('will-quit', logger.close);

  try {
    const token = randomBytes(32).toString('hex');
    const backendPort = await startBackend(paths, token, app.getVersion());
    logger.pipe('backend:out', backendProcess?.stdout ?? null);
    logger.pipe('backend:err', backendProcess?.stderr ?? null);

    oauthBridge = new OAuthCallbackBridge(() => ({ port: backendPort, token }));
    registerAppProtocol({
      webRoot: paths.webRoot,
      backendPort,
      token,
      beforeOAuthStart: () => oauthBridge!.start()
    });

    mainWindow = createWindow();
    await mainWindow.loadURL('media-organizer://app/');

    const smokeReport = process.env.MEDIA_ORGANIZER_SMOKE_REPORT?.trim();
    if (smokeReport) {
      const expectedMarker = process.env.MEDIA_ORGANIZER_SMOKE_EXPECT?.trim() || null;
      const marker = process.env.MEDIA_ORGANIZER_SMOKE_VALUE?.trim() || 'desktop-smoke-marker';
      const result = await mainWindow.webContents.executeJavaScript(`(async () => {
        const previous = localStorage.getItem('media-organizer:desktop-smoke');
        localStorage.setItem('media-organizer:desktop-smoke', ${JSON.stringify(marker)});
        const response = await fetch('/api/system/runtime');
        return { previous, runtime: await response.json(), status: response.status };
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
