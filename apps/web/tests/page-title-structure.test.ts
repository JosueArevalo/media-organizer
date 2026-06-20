import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const pageFiles = [
  'DashboardPage.tsx',
  'ImportPage.tsx',
  'SelectionPage.tsx',
  'CompressionPage.tsx',
  'GroupingPage.tsx',
  'ExportPage.tsx',
  'NetworkFolderExportPage.tsx',
  'GooglePhotosExportPage.tsx',
  'GoogleDriveExportPage.tsx',
  'SettingsPage.tsx'
];

test('every routed page owns exactly one primary heading', () => {
  for (const pageFile of pageFiles) {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'pages', pageFile), 'utf8');
    const primaryHeadings = source.match(/<h1(?:\s|>)/g) ?? [];

    assert.equal(primaryHeadings.length, 1, `${pageFile} should render exactly one h1`);
    assert.doesNotMatch(source, /<h2 className="page-title">/, `${pageFile} should not use h2 as its page title`);
  }
});

test('the app shell does not render a second page heading bar', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'components', 'AppShell.tsx'), 'utf8');

  assert.doesNotMatch(source, /header-zen|header-title|shell\.header/);
});

test('settings uses the shared page scaffolding without a nested header layout', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src', 'pages', 'SettingsPage.tsx'), 'utf8');

  assert.match(source, /className="page-stack settings-page"/);
  assert.match(source, /className="page-header"/);
  assert.match(source, /className="page-title"/);
  assert.match(source, /className="page-subtitle"/);
  assert.doesNotMatch(source, /settings-header/);
});
