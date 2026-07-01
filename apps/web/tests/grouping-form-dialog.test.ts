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

test('Grouping dialog supports create folder, rename folder, template creation, and template editing', () => {
  assert.match(pageSource, /kind: 'create-folder'/);
  assert.match(pageSource, /kind: 'rename-folder'/);
  assert.match(pageSource, /kind: 'create-template'/);
  assert.match(pageSource, /kind: 'edit-template'/);
  assert.match(pageSource, /createGroupingFolderRequest/);
  assert.match(pageSource, /renameGroupingFolderRequest/);
  assert.match(pageSource, /createGroupingTemplateRequest/);
  assert.match(pageSource, /updateGroupingTemplateRequest/);
  assert.match(pageSource, /formatTemplatePreview/);
  assert.match(pageSource, /templateValuePrompt/);
  assert.match(pageSource, /templateHelpIntro/);
  assert.match(pageSource, /setFormDialog\(null\)/);
});

test('Grouping templates expose explicit actions and inline help', () => {
  assert.match(pageSource, /templatesInfoTitle/);
  assert.match(pageSource, /templatesInfoDateNote/);
  assert.match(pageSource, /handleCreateFolderFromTemplate/);
  assert.match(pageSource, /handleEditTemplate/);
  assert.match(pageSource, /grouping-template-copy/);
  assert.match(pageSource, /placement="top-start"/);
  assert.match(pageSource, /grouping-templates-info-trigger/);
  assert.match(pageSource, /icon="plain"/);
  assert.doesNotMatch(pageSource, /grouping\.on/);
  assert.doesNotMatch(pageSource, /grouping\.off/);
  assert.match(stylesSource, /\.grouping-template-help/);
  assert.match(stylesSource, /\.grouping-section-title/);
  assert.match(stylesSource, /\.grouping-templates-info-content/);
  assert.match(stylesSource, /\.info-tooltip-content-top-start/);
  assert.match(stylesSource, /\.info-tooltip-glyph/);
});
