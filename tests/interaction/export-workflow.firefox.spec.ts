import { test } from '@playwright/test';
import { verifyExportSelection, verifyExportScopeQueue, verifyExportFollowup, verifyExportAccountIsolation, verifyExportRetry, verifyPausedRunner, verifyExportContextIsolation, verifyNetworkDestinationIsolation } from './exportWorkflow.assertions';

for (const provider of ['google-photos', 'network-folder'] as const) {
  test(`${provider} previews, selects, pauses and restores without automatic export`, async ({ page, baseURL }) => {
    await verifyExportSelection(page, `${baseURL}/tests/interaction/export-workflow.html`, provider);
  });
  test(`${provider} serializes scope changes and restores confirmed selection on failure`, async ({ page, baseURL }) => {
    await verifyExportScopeQueue(page, `${baseURL}/tests/interaction/export-workflow.html`, provider);
  });
  test(`${provider} exports remaining groups in a new job`, async ({ page, baseURL }) => {
    await verifyExportFollowup(page, `${baseURL}/tests/interaction/export-workflow.html`, provider);
  });
  test(`${provider} retries failures in the existing job`, async ({ page, baseURL }) => {
    await verifyExportRetry(page, `${baseURL}/tests/interaction/export-workflow.html`, provider);
  });
  test(`${provider} waits for the paused runner before enabling scope and resume`, async ({ page, baseURL }) => {
    await verifyPausedRunner(page, `${baseURL}/tests/interaction/export-workflow.html`, provider);
  });
  test(`${provider} ignores preview responses from the previous source and session`, async ({ page, baseURL }) => {
    await verifyExportContextIsolation(page, `${baseURL}/tests/interaction/export-workflow.html`, provider);
  });
}
test('Google Photos discards preview responses from the previous account', async ({ page, baseURL }) => {
  await verifyExportAccountIsolation(page, `${baseURL}/tests/interaction/export-workflow.html`);
});
test('Network Folder ignores preview responses from the previous destination', async ({ page, baseURL }) => {
  await verifyNetworkDestinationIsolation(page, `${baseURL}/tests/interaction/export-workflow.html`);
});
