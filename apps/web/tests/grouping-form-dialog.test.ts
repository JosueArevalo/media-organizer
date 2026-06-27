import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pageSource = fs.readFileSync(path.resolve('src/pages/GroupingPage.tsx'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

test('Grouping replaces browser prompts with an accessible React dialog', () => {
  assert.doesNotMatch(pageSource, /window\.prompt/);
  assert.match(pageSource, /const GroupingFormDialog =/);
  assert.match(pageSource, /role="dialog"/);
  assert.match(pageSource, /aria-modal="true"/);
  assert.match(pageSource, /autoFocus/);
  assert.match(pageSource, /event\.key === 'Escape'/);
  assert.match(pageSource, /type="submit"/);
  assert.match(pageSource, /disabled=\{submitDisabled \|\| isSubmitting\}/);
  assert.match(stylesSource, /\.grouping-form-dialog-panel/);
});

test('Grouping dialog supports create folder, rename folder, and template creation', () => {
  assert.match(pageSource, /kind: 'create-folder'/);
  assert.match(pageSource, /kind: 'rename-folder'/);
  assert.match(pageSource, /kind: 'create-template'/);
  assert.match(pageSource, /createGroupingFolderRequest/);
  assert.match(pageSource, /renameGroupingFolderRequest/);
  assert.match(pageSource, /createGroupingTemplateRequest/);
  assert.match(pageSource, /patternTouched/);
  assert.match(pageSource, /setFormDialog\(null\)/);
});
