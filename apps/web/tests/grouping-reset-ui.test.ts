import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pagesRoot = path.resolve(process.cwd(), 'src', 'pages');
const servicesRoot = path.resolve(process.cwd(), 'src', 'services');
const i18nRoot = path.resolve(process.cwd(), 'src', 'i18n', 'locales');

test('grouping reset button uses the reset API and refreshes workspace after confirmation', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(servicesRoot, 'grouping.service.ts'), 'utf8');
  const resetHandlerStart = pageSource.indexOf('const handleReset = async () => {');
  const resetHandlerEnd = pageSource.indexOf('const mediaUrl = previewItem && workspace', resetHandlerStart);
  const resetHandlerSource = pageSource.slice(resetHandlerStart, resetHandlerEnd);

  assert.match(serviceSource, /resetGroupingWorkspaceRequest/);
  assert.match(serviceSource, /\/api\/grouping\/\$\{sessionId\}\/reset/);
  assert.match(resetHandlerSource, /window\.confirm\(t\('grouping\.resetConfirm'\)\)/);
  assert.match(resetHandlerSource, /if \(!confirmed\) \{\s*return;\s*\}/);
  assert.match(resetHandlerSource, /resetGroupingWorkspaceRequest\(workspace\.sessionId\)/);
  assert.match(resetHandlerSource, /refreshWorkspace\(workspace\.sessionId\)/);
  assert.match(resetHandlerSource, /markGroupingDraftChanged\(\)/);
  assert.match(pageSource, /resetExportJobSnapshot\('network-folder'\)/);
  assert.match(pageSource, /resetExportJobSnapshot\('google-photos'\)/);
});

test('grouping reset button is disabled while grouping cannot mutate', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const resetButtonStart = pageSource.indexOf("onClick={() => void handleReset()}");
  const resetButtonSource = pageSource.slice(resetButtonStart - 300, resetButtonStart + 400);

  assert.match(resetButtonSource, /btn btn-danger-secondary/);
  assert.match(resetButtonSource, /disabled=\{!workspace \|\| isApplying \|\| isResetting \|\| !canMutateGrouping\}/);
});

test('grouping reset copy is localized', () => {
  const english = fs.readFileSync(path.join(i18nRoot, 'en.ts'), 'utf8');
  const spanish = fs.readFileSync(path.join(i18nRoot, 'es.ts'), 'utf8');

  assert.match(english, /grouping\.resetConfirm/);
  assert.match(english, /internal grouping backup/);
  assert.match(spanish, /grouping\.resetConfirm/);
  assert.match(spanish, /backup interno de grouping/);
});
