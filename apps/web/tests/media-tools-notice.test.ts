import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMediaToolsNoticeTone } from '../src/components/MediaToolsNotice';

test('media tools notice uses neutral loading, warning for missing tools, and error for blockers', () => {
  assert.equal(getMediaToolsNoticeTone('loading', false), 'loading');
  assert.equal(getMediaToolsNoticeTone('ready', false), 'warning');
  assert.equal(getMediaToolsNoticeTone('ready', true), 'error');
  assert.equal(getMediaToolsNoticeTone('error', false), 'error');
});
