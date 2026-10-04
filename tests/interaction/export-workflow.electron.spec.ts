import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, _electron as electron, type ElectronApplication } from '@playwright/test';
import { verifyExportSelection, verifyExportScopeQueue, verifyExportFollowup, verifyExportAccountIsolation, verifyExportRetry, verifyPausedRunner, verifyExportContextIsolation, verifyNetworkDestinationIsolation } from './exportWorkflow.assertions';

const test = base.extend<{ exportApp: ElectronApplication }>({
  exportApp: async ({ baseURL }, use) => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-export-interaction-'));
    let app: ElectronApplication | undefined;
    try {
      app = await electron.launch({ args: [path.resolve('tests/interaction/support/electron-main.cjs')],
        env: { ...process.env, MEDIA_ORGANIZER_INTERACTION_URL: `${baseURL}/tests/interaction/export-workflow.html`,
          MEDIA_ORGANIZER_TEST_USER_DATA_DIR: userData } });
      await use(app);
    } finally {
      if (app) await app.close();
      fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
});

for (const provider of ['google-photos', 'network-folder'] as const) {
  for (const [name, verify] of [
    ['selection and restoration', verifyExportSelection], ['scope ordering and recovery', verifyExportScopeQueue],
    ['follow-up export', verifyExportFollowup], ['retry failures', verifyExportRetry], ['paused runner', verifyPausedRunner],
    ['source and session isolation', verifyExportContextIsolation]
  ] as const) {
    test(`${provider} ${name} in Electron`, async ({ baseURL, exportApp }) => {
      await verify(await exportApp.firstWindow(), `${baseURL}/tests/interaction/export-workflow.html`, provider);
    });
  }
}
test('Google Photos account isolation in Electron', async ({ baseURL, exportApp }) => {
  await verifyExportAccountIsolation(await exportApp.firstWindow(), `${baseURL}/tests/interaction/export-workflow.html`);
});
test('Network Folder destination isolation in Electron', async ({ baseURL, exportApp }) => {
  await verifyNetworkDestinationIsolation(await exportApp.firstWindow(), `${baseURL}/tests/interaction/export-workflow.html`);
});
