import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pagePath = path.resolve(process.cwd(), 'src', 'pages', 'GooglePhotosExportPage.tsx');

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

test('Google Photos albums section owns upload progress', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const previewDisabledStart = pageSource.indexOf('const isPreviewDisabled = Boolean(');
  const previewDisabledEnd = pageSource.indexOf('const getItemRenderStatus', previewDisabledStart);
  const previewDisabledSource = pageSource.slice(previewDisabledStart, previewDisabledEnd);

  assert.match(pageSource, /uploadAllAlbums/);
  assert.match(pageSource, /uploadAlbum/);
  assert.match(pageSource, /hasPreview/);
  assert.match(pageSource, /activeBackendJobIdOverride/);
  assert.match(pageSource, /const backendJobId = activeBackendJobIdOverride \?\? exportJobState\.backendJobId/);
  assert.match(pageSource, /const currentProgress = progress\?\.jobId === backendJobId \? progress : null/);
  assert.ok(previewDisabledStart >= 0);
  assert.ok(previewDisabledEnd > previewDisabledStart);
  assert.match(pageSource, /disabled=\{isPreviewDisabled\}/);
  assert.doesNotMatch(previewDisabledSource, /isAllVisibleExportCompletedSuccessfully/);
  assert.match(pageSource, /setPreview\(null\)/);
  assert.match(pageSource, /isAllVisibleExportCompletedSuccessfully/);
  assert.match(pageSource, /isAlbumCompletedSuccessfully/);
  assert.match(pageSource, /previewUploadStatusByAlbum/);
  assert.match(pageSource, /album\.uploadStatus/);
  assert.match(pageSource, /albumTitles: \[albumTitle\]/);
  assert.match(pageSource, /const isAlbumComplete = isAlbumCompletedSuccessfully\(album\.albumTitle\)/);
  assert.match(pageSource, /getAlbumDisplayItems\(album\.albumTitle, album\.items, isAlbumComplete\)/);
  assert.match(pageSource, /progressItem\?\.status \?\? \(isAlbumComplete \? 'completed' : 'pending'\)/);
  assert.doesNotMatch(pageSource, /getAlbumDisplayItems\(album\.albumTitle, album\.items, album\.uploadStatus\)/);
  assert.match(pageSource, /getAlbumFailureSummary/);
  assert.match(pageSource, /item\.lastError/);
  assert.match(pageSource, /progressByAlbum/);
  assert.match(pageSource, /handleRetryItem/);
  assert.match(pageSource, /retryExportItemRequest/);
  assert.match(pageSource, /export\.retryItem/);
  assert.doesNotMatch(pageSource, /google-photos-progress-panel/);
  assert.doesNotMatch(pageSource, /albumNoProgress/);
  assert.doesNotMatch(pageSource, /renderAccordionHeader\('progress'/);
});

test('Google Photos restores full album preview after resumable or terminal jobs', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /useExportJobState\('google-photos'/);
  assert.match(pageSource, /exportJobState\.googlePhotosAccountId/);
  assert.match(pageSource, /const currentProgress = progress\?\.jobId === backendJobId \? progress : null/);
  assert.match(pageSource, /const isTerminal = \['completed', 'failed', 'cancelled'\]\.includes\(currentProgress\?\.status \?\? exportStatus\)/);
  assert.match(pageSource, /!isPaused && !isRunning && !isTerminal/);
  assert.match(pageSource, /\|\| preview\)/);
  assert.match(pageSource, /previewGooglePhotosExportRequest\(\{\s*accountId: selectedAccountId,\s*sourceRoot,\s*groupingSessionId: groupingSessionState\.backendSessionId\s*\}\)/);
  assert.match(pageSource, /currentProgress\?\.albumProgress \?\? \[\]/);
  assert.match(pageSource, /visibleAlbums\.map/);
  assert.match(pageSource, /activeAlbum = currentProgress\.albumProgress\.find/);
  assert.match(pageSource, /openOnlySection\('albums'\)/);
});

test('Google Photos starts new uploads from a clean current job snapshot', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const startHandler = pageSource.indexOf('const handleStart = async');
  const pauseHandler = pageSource.indexOf('const handlePause = async', startHandler);
  const startSource = pageSource.slice(startHandler, pauseHandler);
  const overrideIndex = startSource.indexOf('setActiveBackendJobIdOverride(job.job.id);');
  const draftSnapshotIndex = startSource.indexOf('saveGooglePhotosJobSnapshot(job);');
  const initialProgressIndex = startSource.indexOf('const initialProgress = await getExportProgressRequest(job.job.id);');
  const startJobIndex = startSource.indexOf('job = await startExportJobRequest(job.job.id);');
  const saveSnapshotIndex = startSource.indexOf('saveExportJobSnapshot({');

  assert.ok(startHandler >= 0);
  assert.ok(pauseHandler > startHandler);
  assert.match(startSource, /let job = resumeJobId/);
  assert.doesNotMatch(startSource, /setProgress\(null\);\s*job = await startExportJobRequest/);
  assert.ok(overrideIndex >= 0);
  assert.ok(draftSnapshotIndex > overrideIndex);
  assert.ok(initialProgressIndex > draftSnapshotIndex);
  assert.ok(startJobIndex > initialProgressIndex);
  assert.ok(startSource.indexOf('saveGooglePhotosJobSnapshot(job);', startJobIndex) > startJobIndex);
  assert.equal(saveSnapshotIndex, -1);
});

test('Google Photos treats empty pending upload jobs as a preview refresh', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const startHandler = pageSource.indexOf('const handleStart = async');
  const pauseHandler = pageSource.indexOf('const handlePause = async', startHandler);
  const startSource = pageSource.slice(startHandler, pauseHandler);
  const noWorkIndex = startSource.indexOf('job.job.totalItems === 0');
  const noWorkSource = startSource.slice(noWorkIndex, startSource.indexOf('if (!shouldResume)', noWorkIndex + 1));

  assert.ok(noWorkIndex >= 0);
  assert.match(noWorkSource, /previewGooglePhotosExportRequest/);
  assert.match(noWorkSource, /setProgress\(null\)/);
  assert.match(noWorkSource, /setStatusMessage\(t\('export\.googlePhotos\.noPendingItems'\)\)/);
  assert.match(noWorkSource, /return;/);
  assert.doesNotMatch(noWorkSource, /startExportJobRequest/);
  assert.doesNotMatch(noWorkSource, /saveExportJobSnapshot/);
});

test('Google Photos restoration never starts or resumes an export automatically', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const componentStart = pageSource.indexOf('export const GooglePhotosExportPage');
  const startHandler = pageSource.indexOf('const handleStart', componentStart);
  const restorationSource = pageSource.slice(componentStart, startHandler);

  assert.ok(componentStart >= 0);
  assert.ok(startHandler > componentStart);
  assert.doesNotMatch(restorationSource, /startExportJobRequest\(/);
});

test('Google Photos preserves terminal completion timestamps across progress refreshes', () => {
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const syncStart = pageSource.indexOf('const syncSnapshot = useCallback');
  const resetStart = pageSource.indexOf('const resetGooglePhotosExportState', syncStart);
  const syncSource = pageSource.slice(syncStart, resetStart);

  assert.ok(syncStart >= 0);
  assert.ok(resetStart > syncStart);
  assert.match(syncSource, /const completedAt = \['completed', 'failed', 'cancelled'\]\.includes\(nextProgress\.status\)/);
  assert.match(syncSource, /exportJobState\.backendJobId === nextProgress\.jobId && exportJobState\.completedAt/);
  assert.match(syncSource, /completedAt,/);
});

test('Google Photos item states keep distinct visual styles', () => {
  const stylesPath = path.resolve(process.cwd(), 'src', 'styles.css');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stylesSource = fs.readFileSync(stylesPath, 'utf8');

  assert.match(stylesSource, /\.status-pending\s*\{/);
  assert.match(stylesSource, /\.status-running\s*\{/);
  assert.match(stylesSource, /\.status-paused\s*\{/);
  assert.match(stylesSource, /\.google-photos-upload-action\.btn-compact\s*\{/);
  assert.match(stylesSource, /rgba\(20, 184, 166, 0\.14\)/);
  assert.match(stylesSource, /#2dd4bf/);
  assert.match(pageSource, /getItemRenderStatus/);
  assert.match(pageSource, /export\.itemStatus\.paused/);
  assert.doesNotMatch(stylesSource, /\.status-running,\s*\.status-pending/);
  assert.doesNotMatch(stylesSource, /#2563eb/);
  assert.doesNotMatch(stylesSource, /rgba\(59, 130, 246, 0\.16\)/);
});
