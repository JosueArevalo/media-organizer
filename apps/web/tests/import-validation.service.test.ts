import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isDestinationInsideSourcePath,
  normalizeImportPathForComparison,
  validateImportFoldersLocally
} from '../src/services/import-validation.service';

test('normalizeImportPathForComparison normalizes separators, casing, and trailing slashes', () => {
  assert.equal(
    normalizeImportPathForComparison('C:\\Fake\\Media\\Input\\'),
    'c:/fake/media/input'
  );
});

test('isDestinationInsideSourcePath detects direct and nested destination paths', () => {
  assert.equal(
    isDestinationInsideSourcePath('C:\\Fake\\Media\\Input', 'C:\\Fake\\Media\\Input\\Output'),
    true
  );
  assert.equal(
    isDestinationInsideSourcePath('C:\\Fake\\Media\\Input', 'C:\\Fake\\Media\\Input\\Nested\\Output'),
    true
  );
});

test('isDestinationInsideSourcePath allows sibling destination paths', () => {
  assert.equal(
    isDestinationInsideSourcePath('C:\\Fake\\Media\\Input', 'C:\\Fake\\Media\\Output'),
    false
  );
});

test('validateImportFoldersLocally blocks same paths and destination inside source', () => {
  const samePath = validateImportFoldersLocally('C:\\Fake\\Media\\Input', 'C:\\Fake\\Media\\Input\\');
  const nestedPath = validateImportFoldersLocally('C:\\Fake\\Media\\Input', 'C:\\Fake\\Media\\Input\\Output');

  assert.equal(samePath.ok, false);
  assert.equal(samePath.ok ? '' : samePath.code, 'same_path');
  assert.equal(nestedPath.ok, false);
  assert.equal(nestedPath.ok ? '' : nestedPath.code, 'destination_inside_source');
});
