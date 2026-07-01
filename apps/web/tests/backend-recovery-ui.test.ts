import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const readSource = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), 'utf8');

test('backend recovery banner exposes restart, logs, and copy actions', () => {
  const source = readSource('src/components/BackendRecoveryBanner.tsx');
  assert.match(source, /recovery\.restart\(\)/);
  assert.match(source, /recovery\.openLogs\(\)/);
  assert.match(source, /recovery\.copyDiagnostics\(\)/);
  assert.match(source, /shouldShowRecovery/);
});

test('desktop diagnostics remain available from settings and are hidden on the web', () => {
  const source = readSource('src/pages/SettingsPage.tsx');
  assert.match(source, /desktopBridge &&/);
  assert.match(source, /handleOpenLogs/);
  assert.match(source, /handleCopyDiagnostics/);
});

test('sidebar footer separates version from controls and uses local SVG flags', () => {
  const shell = readSource('src/components/AppShell.tsx');
  const flag = readSource('src/components/LanguageFlag.tsx');
  const styles = readSource('src/styles.css');
  assert.match(shell, /sidebar-footer-controls/);
  assert.match(shell, /<LanguageFlag locale=/);
  assert.match(flag, /<svg/);
  assert.match(styles, /min-width: 140px/);
  assert.doesNotMatch(styles, /fonts\.googleapis\.com/);
});

test('theme initialization no longer relies on an inline CSP-blocked script', () => {
  const html = readSource('index.html');
  const main = readSource('src/main.tsx');
  assert.doesNotMatch(html, /<script>\s*\(function/);
  assert.match(main, /initializeDocumentTheme\(\)/);
});
