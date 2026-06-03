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
  assert.match(pageSource, /albumTitles: \[albumTitle\]/);
  assert.match(pageSource, /getAlbumDisplayItems\(album\.albumTitle, album\.items\)/);
  assert.match(pageSource, /getAlbumFailureSummary/);
  assert.match(pageSource, /item\.lastError/);
  assert.match(pageSource, /progressByAlbum/);
  assert.doesNotMatch(pageSource, /google-photos-progress-panel/);
  assert.doesNotMatch(pageSource, /albumNoProgress/);
  assert.doesNotMatch(pageSource, /renderAccordionHeader\('progress'/);
});
