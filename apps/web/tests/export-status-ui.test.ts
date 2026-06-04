import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pagesRoot = path.resolve(process.cwd(), 'src', 'pages');
const hooksRoot = path.resolve(process.cwd(), 'src', 'hooks');

test('export hub only renders the completion check for complete coverage', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'ExportPage.tsx'), 'utf8');
  assert.match(source, /coverage === 'completed'/);
  assert.match(source, /export-provider-check/);
  assert.match(source, /export\.coverage\.items/);
  assert.match(source, /export\.coverage\.albums/);
});

test('dashboard renders persisted provider summaries and completed destinations', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'DashboardPage.tsx'), 'utf8');
  assert.match(source, /ExportSummary exports=\{execution\.exports\}/);
  assert.match(source, /completedDestinations\.slice/);
  assert.match(source, /dashboard\.exportLastAttempt/);
});

test('provider pages consume only their own active export snapshot', () => {
  const networkSource = fs.readFileSync(path.join(pagesRoot, 'NetworkFolderExportPage.tsx'), 'utf8');
  const googleSource = fs.readFileSync(path.join(pagesRoot, 'GooglePhotosExportPage.tsx'), 'utf8');

  assert.match(networkSource, /useExportJobState\('network-folder'/);
  assert.match(googleSource, /useExportJobState\('google-photos'/);
});

test('export completion notifications ignore paused jobs', () => {
  const source = fs.readFileSync(path.join(hooksRoot, 'useCompletionNotifications.ts'), 'utf8');
  const exportNotification = source.slice(source.indexOf('for (const exportJobState'));

  assert.match(exportNotification, /previousStatus !== 'completed'/);
  assert.match(exportNotification, /exportJobState\.status === 'completed'/);
  assert.doesNotMatch(exportNotification, /exportJobState\.status === 'paused'[\s\S]*notifyCompletion\('exportCompleted'/);
});
