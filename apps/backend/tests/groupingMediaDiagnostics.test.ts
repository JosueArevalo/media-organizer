import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beginGroupingMediaOperation,
  getActiveGroupingMediaOperations
} from '../src/pipeline/grouping/groupingMediaDiagnostics.js';

test('grouping media traces identify active and completed requests', () => {
  const messages: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => messages.push(String(message));
  try {
    const trace = beginGroupingMediaOperation({ operation: 'thumbnail', sessionId: 'session-1', itemId: 'item-1', fileName: 'photo.jpg' });
    assert.equal(getActiveGroupingMediaOperations()[0]?.fileName, 'photo.jpg');
    trace.finish('failed', new Error('broken image'));
    assert.equal(getActiveGroupingMediaOperations().length, 0);
    assert.match(messages[0], /start.*operation=thumbnail.*item=item-1.*photo\.jpg/);
    assert.match(messages[1], /finish.*status=failed.*broken image/);
  } finally {
    console.log = original;
  }
});
