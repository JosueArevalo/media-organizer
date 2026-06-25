import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const workspaceRoot = 'd:/Software Development/media-organizer';

test('Grouping grid uses thumbnails and avoids persistent video streams', () => {
  const pageSource = fs.readFileSync(path.join(workspaceRoot, 'apps', 'web', 'src', 'pages', 'GroupingPage.tsx'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(workspaceRoot, 'apps', 'web', 'src', 'services', 'grouping.service.ts'), 'utf8');
  const posterServiceSource = fs.readFileSync(path.join(workspaceRoot, 'apps', 'web', 'src', 'services', 'video-poster.service.ts'), 'utf8');

  assert.match(serviceSource, /buildGroupingThumbnailUrl/);
  assert.match(serviceSource, /buildGroupingVideoPosterUrl/);
  assert.match(pageSource, /buildGroupingThumbnailUrl/);
  assert.match(pageSource, /buildGroupingVideoPosterUrl/);
  assert.match(pageSource, /itemThumbnailUrl/);
  assert.match(pageSource, /buildGroupingPreviewUrl\(workspace\.sessionId, previewItem\.id\)/);
  assert.match(pageSource, /generateVideoPoster/);
  assert.match(pageSource, /videoPosterCacheKey/);
  assert.match(pageSource, /GROUPING_GRID_INITIAL_LIMIT/);
  assert.match(pageSource, /const GroupingMediaPreview =/);
  assert.match(pageSource, /IntersectionObserver/);
  assert.match(pageSource, /grouping-media-type-badge/);
  assert.match(posterServiceSource, /MAX_CONCURRENT_POSTERS = 2/);
  assert.match(posterServiceSource, /cleanupVideo/);

  const previewComponentStart = pageSource.indexOf('const GroupingMediaPreview =');
  const previewComponentEnd = pageSource.indexOf('const ensureDirectoryNode', previewComponentStart);
  const previewComponentSource = pageSource.slice(previewComponentStart, previewComponentEnd);

  assert.doesNotMatch(previewComponentSource, /<video/);
  assert.doesNotMatch(previewComponentSource, /controls/);
  assert.doesNotMatch(previewComponentSource, /autoPlay/);
});

test('Grouping modal cleans the active video stream on close or item changes', () => {
  const pageSource = fs.readFileSync(path.join(workspaceRoot, 'apps', 'web', 'src', 'pages', 'GroupingPage.tsx'), 'utf8');

  assert.match(pageSource, /const modalVideoRef = useRef<HTMLVideoElement/);
  assert.match(pageSource, /modalVideoObjectUrl/);
  assert.match(pageSource, /fetch\(mediaUrl, \{ signal: controller\.signal \}\)/);
  assert.match(pageSource, /URL\.createObjectURL\(blob\)/);
  assert.match(pageSource, /URL\.revokeObjectURL/);
  assert.match(pageSource, /cleanupModalVideo/);
  assert.match(pageSource, /video\.removeAttribute\('src'\)/);
  assert.match(pageSource, /key=\{previewItem\.id\}/);
  assert.match(pageSource, /ref=\{modalVideoRef\}/);
  assert.match(pageSource, /src=\{modalVideoObjectUrl\}/);
  assert.doesNotMatch(pageSource, /<video[^>]+src=\{mediaUrl\}/);
});
