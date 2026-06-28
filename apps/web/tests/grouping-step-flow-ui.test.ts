import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pagesRoot = path.resolve(process.cwd(), 'src', 'pages');
const servicesRoot = path.resolve(process.cwd(), 'src', 'services');
const i18nRoot = path.resolve(process.cwd(), 'src', 'i18n', 'locales');
const stylesPath = path.resolve(process.cwd(), 'src', 'styles.css');

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
  const setupHandlerEnd = pageSource.indexOf('const handleCreateFolder = () => {', setupHandlerStart);
  const setupHandlerSource = pageSource.slice(setupHandlerStart, setupHandlerEnd);

  assert.match(pageSource, /const hasSetupChanges = Boolean/);
  assert.match(pageSource, /const \[requiresProposalRefresh, setRequiresProposalRefresh\] = useState\(false\)/);
  assert.match(pageSource, /const shouldUpdateGroupingProposal = requiresProposalRefresh \|\| !hasGroupingProposal \|\| hasSetupChanges/);
  assert.match(setupHandlerSource, /if \(shouldUpdateGroupingProposal\) \{\s*await handleReorganize\(\);/);
  assert.match(setupHandlerSource, /changeGroupingView\('review'\)/);
});

test('grouping reset returns the user to setup', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const resetHandlerStart = pageSource.indexOf('const handleReset = async () => {');
  const resetHandlerEnd = pageSource.indexOf('const mediaUrl = previewItem && workspace', resetHandlerStart);
  const resetHandlerSource = pageSource.slice(resetHandlerStart, resetHandlerEnd);

  assert.match(resetHandlerSource, /refreshWorkspace\(workspace\.sessionId\)/);
  assert.match(resetHandlerSource, /setRequiresProposalRefresh\(true\)/);
  assert.match(resetHandlerSource, /changeGroupingView\('setup'\)/);
  assert.match(resetHandlerSource, /activeView: 'setup'/);
  assert.doesNotMatch(resetHandlerSource, /setSelectedStrategy\(nextWorkspace\.strategy\)/);
  assert.doesNotMatch(resetHandlerSource, /setPreservedDirectories\(new Set\(nextWorkspace\.preservedDirectories\)\)/);
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

test('grouping setup uses an accessible segmented strategy selector', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');

  assert.match(pageSource, /grouping\.strategy\.recommended/);
  assert.match(pageSource, /className="grouping-strategy-selector" role="group"/);
  assert.match(pageSource, /aria-pressed=\{selectedStrategy === 'date'\}/);
  assert.match(pageSource, /aria-pressed=\{selectedStrategy === 'source-folder'\}/);
  assert.match(pageSource, /useState<GroupingStrategy \| null>\('date'\)/);
  assert.match(pageSource, /setSelectedStrategy\(nextWorkspace\.strategy \?\? 'date'\)/);
  assert.doesNotMatch(pageSource, /<option value="nearest-folder"/);
  assert.match(pageSource, /setSourceFolderMode\('relative-path'\)/);
});

test('grouping setup renders one contextual strategy panel and date example', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const english = fs.readFileSync(path.join(i18nRoot, 'en.ts'), 'utf8');
  const spanish = fs.readFileSync(path.join(i18nRoot, 'es.ts'), 'utf8');

  assert.match(pageSource, /IMG_20120915_153738\.jpg/);
  assert.match(pageSource, /IMG_20120915_162710\.jpg/);
  assert.match(pageSource, /IMG_20120918_092158\.jpg/);
  assert.match(pageSource, /SINGLE_DATE_EXAMPLE_DESTINATIONS\[singleDateHandling\]/);
  assert.match(pageSource, /2012\.09\.15 - Event/);
  assert.match(pageSource, /selectedStrategy === 'date'/);
  assert.match(pageSource, /selectedStrategy === 'source-folder'/);
  assert.match(pageSource, /grouping\.noDateHandlingNote/);
  assert.match(english, /Files without a recognizable date remain in their current folder/);
  assert.match(spanish, /Los archivos sin una fecha reconocible permanecen en su carpeta actual/);
});

test('grouping folder exclusions use an actionable expanded header', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');

  assert.match(pageSource, /<details className="page-card elevated grouping-exclusions grouping-setup-main" open>/);
  assert.match(pageSource, /grouping\.excludedCount/);
  assert.match(pageSource, /grouping\.reviewFolders/);
  assert.match(pageSource, /grouping-exclusions-icon/);
  assert.match(pageSource, /grouping-exclusions-chevron/);
  assert.doesNotMatch(pageSource, /grouping\.optional/);
  assert.doesNotMatch(pageSource, /grouping\.setupSummary/);
});

test('grouping comparison controls align the recommended badge and center the arrow lane', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(pageSource, /className="grouping-strategy-badge"/);
  assert.match(styles, /\.grouping-strategy-badge \{[\s\S]*align-items: center;[\s\S]*display: inline-flex;[\s\S]*min-height: 18px;/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 64px minmax\(0, 1fr\);/);
  assert.match(styles, /\.grouping-example-arrow \{[\s\S]*justify-self: center;/);
});

test('grouping date result indents files below their destination folders', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(styles, /\.grouping-example-group > ul \{[\s\S]*border-left: 1px solid var\(--line\);[\s\S]*padding-left: 14px;/);
  assert.match(styles, /\.grouping-example-group > ul > li::before/);
});

test('grouping exclusions heading stays on one line outside narrow mobile layouts', () => {
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(styles, /\.grouping-exclusions-leading \{[\s\S]*flex: 1 1 auto;[\s\S]*min-width: 0;/);
  assert.match(styles, /\.grouping-exclusions-title > strong \{[\s\S]*white-space: nowrap;/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*\.grouping-exclusions-title > strong \{[\s\S]*white-space: normal;/);
});

test('grouping review no longer locks preserved folders or media cards', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const english = fs.readFileSync(path.join(i18nRoot, 'en.ts'), 'utf8');
  const spanish = fs.readFileSync(path.join(i18nRoot, 'es.ts'), 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(pageSource, /renamePreservedGroupingFolderScopeRequest/);
  assert.match(pageSource, /handleRenamePreservedFolder/);
  assert.match(pageSource, /const sidebarEntries = useMemo<GroupingSidebarEntry\[]>\(\(\) => \{/);
  assert.match(pageSource, /preservedFolderScopes\.map\(\(scope\) => \(\{/);
  assert.match(pageSource, /workspace\.folders\.map\(\(folder\) => \(\{/);
  assert.match(pageSource, /\.sort\(\(left, right\) => left\.label\.localeCompare\(right\.label, undefined, \{ sensitivity: 'base' \}\)\)/);
  assert.match(pageSource, /visibleItems\.map\(\(item\) => item\.id\)/);
  assert.match(pageSource, /const canEditItem = canMutateGrouping;/);
  assert.match(pageSource, /entry\.itemCount > 0/);
  assert.match(pageSource, /sidebarEntries\.map\(\(entry\) => \(/);
  assert.doesNotMatch(pageSource, /grouping-folder-list">\s*\{preservedFolderScopes\.map/);
  assert.doesNotMatch(pageSource, /groupingItemLocked/);
  assert.doesNotMatch(pageSource, /grouping-folder-drop-preserved/);
  assert.doesNotMatch(pageSource, /previewItem\.preservedStructure/);
  assert.doesNotMatch(styles, /\.grouping-folder-drop-preserved \{/);
  assert.doesNotMatch(english, /grouping\.preservedFolderLocked/);
  assert.doesNotMatch(spanish, /grouping\.preservedFolderLocked/);
});

test('grouping reorganize clears reset-invalidated proposals', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const reorganizeHandlerStart = pageSource.indexOf('const handleReorganize = async () => {');
  const reorganizeHandlerEnd = pageSource.indexOf('const handleSetupPrimaryAction = async () => {', reorganizeHandlerStart);
  const reorganizeHandlerSource = pageSource.slice(reorganizeHandlerStart, reorganizeHandlerEnd);

  assert.match(reorganizeHandlerSource, /setRequiresProposalRefresh\(false\)/);
});

test('grouping setup tree relies on the structure toggle instead of directory badges', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');
  const selectionRowsStart = pageSource.indexOf('directoryRows.map((row) =>');
  const selectionRowsEnd = pageSource.indexOf('{workspace && view === \'review\'', selectionRowsStart);
  const selectionRowsSource = pageSource.slice(selectionRowsStart, selectionRowsEnd);

  assert.match(selectionRowsSource, /<div className="selection-row-head">\s*<strong>\{row\.name\}<\/strong>\s*<\/div>/);
  assert.match(selectionRowsSource, /<p className="selection-row-note">\{row\.path\}<\/p>/);
  assert.match(selectionRowsSource, /className=\{row\.isPreserved \? 'is-active' : ''\}/);
  assert.match(selectionRowsSource, /onClick=\{\(\) => setDirectoryStructureMode\(row\.path, 'preserve'\)\}/);
  assert.match(selectionRowsSource, /onClick=\{\(\) => setDirectoryStructureMode\(row\.path, 'reorganize'\)\}/);
  assert.doesNotMatch(selectionRowsSource, /page-chip/);
  assert.doesNotMatch(selectionRowsSource, /t\('grouping\.keepOverride'\)/);
  assert.doesNotMatch(selectionRowsSource, /t\('grouping\.inherited'\)/);
  assert.doesNotMatch(selectionRowsSource, /t\('grouping\.reorganizeOverride'\)/);
});

test('grouping review sidebar selection only scrolls when the main panel is out of view', () => {
  const pageSource = fs.readFileSync(path.join(pagesRoot, 'GroupingPage.tsx'), 'utf8');

  assert.match(pageSource, /const isGroupingMainVisible = useCallback\(\(\) => \{/);
  assert.match(pageSource, /const rect = container\.getBoundingClientRect\(\);/);
  assert.match(pageSource, /return rect\.bottom > 0 && rect\.top < window\.innerHeight;/);
  assert.match(pageSource, /const handleSelectReviewFolder = useCallback\(\(nextLabel: string\) => \{/);
  assert.match(pageSource, /setActiveFolderLabel\(nextLabel\);/);
  assert.match(pageSource, /if \(isGroupingMainVisible\(\)\) \{\s*return;\s*\}/);
  assert.match(pageSource, /groupingMainRef\.current\?\.scrollIntoView\(\{\s*behavior: 'smooth',\s*block: 'start'\s*\}\);/);
  assert.match(pageSource, /onClick=\{\(\) => handleSelectReviewFolder\('__all__'\)\}/);
  assert.match(pageSource, /onClick=\{\(\) => handleSelectReviewFolder\(entry\.activeLabel\)\}/);
  assert.match(pageSource, /onClick=\{\(\) => handleSelectReviewFolder\('__unassigned__'\)\}/);
});
