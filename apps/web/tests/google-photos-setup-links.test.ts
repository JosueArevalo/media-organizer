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

  assert.match(pageSource, /uploadAllAlbums/);
  assert.match(pageSource, /uploadAlbum/);
  assert.match(pageSource, /hasPreview/);
  assert.match(pageSource, /disabled=\{!sourceRoot \|\| !selectedAccountId \|\| isPreviewing \|\| hasPreview \|\| isAllVisibleExportCompletedSuccessfully\}/);
  assert.match(pageSource, /setPreview\(null\)/);
  assert.match(pageSource, /isAllVisibleExportCompletedSuccessfully/);
  assert.match(pageSource, /isAlbumCompletedSuccessfully/);
  assert.match(pageSource, /albumTitles: \[albumTitle\]/);
  assert.match(pageSource, /getAlbumDisplayItems\(album\.albumTitle, album\.items\)/);
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
