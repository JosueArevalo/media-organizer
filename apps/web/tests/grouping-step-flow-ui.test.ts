import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pagesRoot = path.resolve(process.cwd(), 'src', 'pages');
const servicesRoot = path.resolve(process.cwd(), 'src', 'services');
const i18nRoot = path.resolve(process.cwd(), 'src', 'i18n', 'locales');

test('grouping stores and restores the active setup or review view', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const storeSource = fs.readFileSync(path.join(servicesRoot, 'grouping-job.store.ts'), 'utf8');

  assert.match(storeSource, /export type GroupingActiveView = 'setup' \| 'review'/);
  assert.match(storeSource, /activeView: GroupingActiveView \| null/);
  assert.match(storeSource, /export const setGroupingActiveView/);
  assert.match(pageSource, /setGroupingActiveView\(nextView\)/);
  assert.match(pageSource, /groupingSessionState\.activeView \?\?/);
});

test('grouping setup primary action reviews an unchanged proposal without reorganizing', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const setupHandlerStart = pageSource.indexOf('const handleSetupPrimaryAction = async () => {');
  const setupHandlerEnd = pageSource.indexOf('const handleCreateFolder = async () => {', setupHandlerStart);
  const setupHandlerSource = pageSource.slice(setupHandlerStart, setupHandlerEnd);

  assert.match(pageSource, /const hasSetupChanges = Boolean/);
  assert.match(pageSource, /const shouldUpdateGroupingProposal = !hasGroupingProposal \|\| hasSetupChanges/);
  assert.match(setupHandlerSource, /if \(shouldUpdateGroupingProposal\) \{\s*await handleReorganize\(\);/);
  assert.match(setupHandlerSource, /changeGroupingView\('review'\)/);
});

test('grouping reset returns the user to setup', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const resetHandlerStart = pageSource.indexOf('const handleReset = async () => {');
  const resetHandlerEnd = pageSource.indexOf('const mediaUrl = previewItem && workspace', resetHandlerStart);
  const resetHandlerSource = pageSource.slice(resetHandlerStart, resetHandlerEnd);

  assert.match(resetHandlerSource, /refreshWorkspace\(workspace\.sessionId\)/);
  assert.match(resetHandlerSource, /changeGroupingView\('setup'\)/);
  assert.match(resetHandlerSource, /activeView: 'setup'/);
});

test('grouping setup flow copy is localized', () => {
  const english = fs.readFileSync(path.join(i18nRoot, 'en.ts'), 'utf8');
  const spanish = fs.readFileSync(path.join(i18nRoot, 'es.ts'), 'utf8');

  assert.match(english, /grouping\.updateProposal/);
  assert.match(english, /Update proposal/);
  assert.match(english, /grouping\.reviewOrganization/);
  assert.match(english, /Review organization/);
  assert.match(spanish, /grouping\.updateProposal/);
  assert.match(spanish, /Actualizar propuesta/);
  assert.match(spanish, /grouping\.reviewOrganization/);
  assert.match(spanish, /Revisar organizacion/);
});
