import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEffectiveSourceKind } from '../src/state/dto/state.types.js';

test('resolveEffectiveSourceKind prefers override when present', () => {
  const result = resolveEffectiveSourceKind({
    sourceKindDetected: 'camera',
    sourceKindOverride: 'whatsapp'
  });

  assert.equal(result, 'whatsapp');
});

test('resolveEffectiveSourceKind falls back to detected kind', () => {
  const result = resolveEffectiveSourceKind({
    sourceKindDetected: 'screenshot',
    sourceKindOverride: null
  });

  assert.equal(result, 'screenshot');
});
