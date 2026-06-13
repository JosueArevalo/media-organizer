import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const workspaceRoot = 'd:/Software Development/media-organizer';

test('Grouping grid uses thumbnails and keeps full media for the modal', () => {
  const pageSource = fs.readFileSync(path.join(workspaceRoot, 'apps', 'web', 'src', 'pages', 'GroupingPage.tsx'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(workspaceRoot, 'apps', 'web', 'src', 'services', 'grouping.service.ts'), 'utf8');

  assert.match(serviceSource, /buildGroupingThumbnailUrl/);
  assert.match(pageSource, /buildGroupingThumbnailUrl/);
  assert.match(pageSource, /itemThumbnailUrl/);
  assert.match(pageSource, /buildGroupingPreviewUrl\(workspace\.sessionId, previewItem\.id\)/);
  assert.match(pageSource, /GROUPING_GRID_INITIAL_LIMIT/);
  assert.doesNotMatch(pageSource, /<video src=\{itemMediaUrl\}/);
});
