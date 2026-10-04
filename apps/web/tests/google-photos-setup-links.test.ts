import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pagePath = path.resolve(process.cwd(), 'src', 'pages', 'GooglePhotosExportPage.tsx');
const hookPath = path.resolve(process.cwd(), 'src', 'hooks', 'useExportWorkflow.ts');
const panelPath = path.resolve(process.cwd(), 'src', 'components', 'ExportWorkflowPanel.tsx');
const progressViewPath = path.resolve(process.cwd(), 'src', 'services', 'export-progress-view.ts');

test('Google Photos setup guide keeps direct Google Cloud links', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  for (const expectedLink of [
    'https://console.cloud.google.com/projectselector2/home/dashboard',
    'https://console.cloud.google.com/apis/library/photoslibrary.googleapis.com',
    'https://console.cloud.google.com/auth/audience',
    'https://console.cloud.google.com/auth/overview',
    'https://console.cloud.google.com/auth/clients',
    'https://console.cloud.google.com/apis/credentials'
  ]) {
    assert.match(pageSource, new RegExp(expectedLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Google Photos setup keeps the simplified OAuth flow', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /saveConfig/);
  assert.match(pageSource, /clientSecretRequired/);
  assert.match(pageSource, /connectAnotherAccount/);
  assert.match(pageSource, /isLoadingOAuthConfig/);
  assert.match(pageSource, /loadingConfig/);
  assert.match(pageSource, /loadingAccounts/);
  assert.doesNotMatch(pageSource, /saveAndConnect/);
  assert.doesNotMatch(pageSource, /permissionsTitle|troubleshootingTitle|google-photos-advanced|google-photos-troubleshooting/);
});

test('Google Photos source context is outside the accordion sections', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /google-photos-source-context/);
  assert.doesNotMatch(pageSource, /renderAccordionHeader\('source'/);
});

test('Google Photos hides connect while sign-in is waiting for account refresh', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /isGoogleSignInPendingRefresh/);
  assert.match(pageSource, /shouldShowConnectAccount/);
  assert.match(pageSource, /setIsGoogleSignInPendingRefresh\(true\)/);
});

test('Google Photos account refresh keeps account and albums sections visible', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /openSectionsManually\(\['account', 'albums'\]\)/);
  assert.match(pageSource, /loadAccounts\(true, true\)/);
  assert.doesNotMatch(pageSource, /openOnlySection\('albums'\);\s*\}\s*setSelectedAccountId/s);
});

test('Google Photos setup guide stays collapsed after reset', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /setIsSetupGuideExpanded\(false\);[\s\S]*resetGooglePhotosExportState\(t\('export\.googlePhotos\.configCleared'\)\)/);
  assert.doesNotMatch(pageSource, /setIsSetupGuideExpanded\(true\)/);
});


test('Google Photos delegates its album flow to the shared hook and panel', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /useExportWorkflow/);
  assert.match(page, /ExportWorkflowPanel workflow=\{workflow\} provider="google-photos"/);
  assert.doesNotMatch(page, /const handle(Start|Pause|RetryItem|Preview) =/);
  assert.match(page, /renderAccordionHeader\('albums'/);
});

test('shared polling remains sequential and terminal reconciliation is deduplicated', () => {
  const hook = fs.readFileSync(hookPath, 'utf8');
  assert.match(hook, /progressRequestRef/);
  assert.match(hook, /window\.setTimeout/);
  assert.doesNotMatch(hook, /window\.setInterval/);
  assert.match(hook, /reconciliationKeysRef\.current\.has\(reconciliationKey\)/);
  assert.match(hook, /isCurrent\(token\)/);
});

test('shared restoration reads persisted jobs and preview without starting exports', () => {
  const hook = fs.readFileSync(hookPath, 'utf8');
  const restore = hook.slice(hook.indexOf('const restore = async'), hook.indexOf('const backendJobId ='));
  assert.match(restore, /listExportJobsRequest/);
  assert.match(restore, /loadPreview/);
  assert.doesNotMatch(restore, /startExportJobRequest|createExportJobRequest|retryFailedExportItemsRequest/);
});

test('completion timestamps and scope writes remain stable across refreshes', () => {
  const hook = fs.readFileSync(hookPath, 'utf8');
  assert.match(hook, /previous\.completedAt \?\? Date\.now\(\)/);
  assert.match(hook, /scopeQueueRef\.current = scopeQueueRef\.current\.then/);
  assert.match(hook, /await scopeQueueRef\.current/);
  assert.match(hook, /getExportJobGroupSelection\(preview, job\)/);
});

test('shared item states preserve partial results, retries and paused styling', () => {
  const view = fs.readFileSync(progressViewPath, 'utf8');
  const panel = fs.readFileSync(panelPath, 'utf8');
  const styles = fs.readFileSync(path.resolve('src', 'styles.css'), 'utf8');
  assert.match(view, /isResolvedStatus\(current\.status\) && !isResolvedStatus\(incoming\.status\)/);
  assert.match(view, /isPaused && tracked\.status === 'running'/);
  assert.match(panel, /handleRetryItem\(item\.id!, item\.jobId\)/);
  assert.match(panel, /item\.status === 'failed' && item\.lastError/);
  assert.match(styles, /\.status-paused\s*\{/);
  assert.match(styles, /\.export-group-export-action\.btn-compact\s*\{/);
});

test('Google Photos still translates album recovery notices', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /workflow\.progress\?\.notices/);
  assert.match(page, /google-photos-album-recreated:/);
  assert.match(page, /export\.googlePhotos\.albumRecoveredNotice/);
});
