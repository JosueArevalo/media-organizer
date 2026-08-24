import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pageSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'pages', 'GroupingPage.tsx'), 'utf8');
const moveMenuSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'components', 'GroupingMoveMenu.tsx'), 'utf8');
const serviceSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'services', 'grouping.service.ts'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(process.cwd(), 'src', 'styles.css'), 'utf8');

test('grouping exposes trash separately from active media', () => {
  assert.match(serviceSource, /trashItems: GroupingWorkspaceItem\[\]/);
  assert.match(pageSource, /workspace\.trashItems\.length/);
  assert.match(pageSource, /activeFolderLabel === TRASH_FOLDER_LABEL \? workspace\.trashItems : workspace\.items/);
  assert.match(pageSource, /activeFolderLabel !== TRASH_FOLDER_LABEL/);
});

test('grouping trash supports API actions and drag and drop', () => {
  assert.match(serviceSource, /\/items\/trash/);
  assert.match(pageSource, /trashGroupingItemsRequest/);
  assert.match(pageSource, /className=\{`grouping-trash-drop/);
  assert.match(pageSource, /void moveItemsToTrash\(JSON\.parse\(ids\)/);
  assert.match(stylesSource, /\.grouping-trash-drop\.is-active/);
});

test('grouping move selectors include every directory shown in the sidebar', () => {
  assert.match(pageSource, /const moveDestinationEntries = useMemo<GroupingMoveDestination\[]>\([\s\S]*sidebarEntries\.map/);
  assert.equal((pageSource.match(/<GroupingMoveMenu/g) ?? []).length, 2);
  assert.equal((pageSource.match(/destinations=\{moveDestinationEntries\}/g) ?? []).length, 2);
  assert.match(pageSource, /preservedScopePath: entry\.kind === 'preserved' \? entry\.scope\.path : undefined/);
  assert.doesNotMatch(pageSource, /<option value="">\{t\('grouping\.moveSelected'\)\}<\/option>/);
  assert.doesNotMatch(pageSource, /<option value="">\{t\('grouping\.movePreview'\)\}<\/option>/);
  assert.doesNotMatch(pageSource, /\{workspace\??\.folders\.map\(\(folder\) => \(\s*<option/);
});

test('grouping move menu is a DOM menu with accessible keyboard controls', () => {
  assert.match(moveMenuSource, /aria-haspopup="menu"/);
  assert.match(moveMenuSource, /aria-expanded=\{isOpen\}/);
  assert.match(moveMenuSource, /role="menu"/);
  assert.match(moveMenuSource, /role="menuitem"/);
  assert.match(moveMenuSource, /event\.key === 'Escape'/);
  assert.match(moveMenuSource, /event\.key === 'ArrowDown'/);
  assert.match(moveMenuSource, /document\.addEventListener\('pointerdown'/);
});

test('grouping promotes preserved destinations through selectors, previews, and drag and drop', () => {
  assert.match(serviceSource, /targetPreservedScopePath\?: string/);
  assert.match(serviceSource, /JSON\.stringify\(\{ itemIds, targetGroupLabel, targetPreservedScopePath \}\)/);
  assert.match(pageSource, /const moveItemsToDestination = async/);
  assert.match(pageSource, /destination\.preservedScopePath/);
  assert.match(pageSource, /onDragOver=\{canMutateGrouping \?/);
  assert.match(pageSource, /void moveItemsToDestination\([\s\S]*preservedScopePath:/);
});

test('grouping trash icon remains aligned despite generic folder label styles', () => {
  assert.match(stylesSource, /\.grouping-folder-button > \.grouping-trash-label \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*gap: 10px;/);
  assert.match(stylesSource, /\.grouping-trash-label svg \{[\s\S]*display: block;[\s\S]*flex: 0 0 17px;/);
});

test('legacy baseline migration is started and polled by grouping', () => {
  assert.match(serviceSource, /legacy-baselines\/migrate/);
  assert.match(serviceSource, /legacy-baselines\/migration/);
  assert.match(pageSource, /startGroupingBaselineMigrationRequest/);
  assert.match(pageSource, /getGroupingBaselineMigrationStatusRequest/);
  assert.match(pageSource, /isBaselineMigrationRunning/);
});
