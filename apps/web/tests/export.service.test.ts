import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidUncPath } from '../src/services/export.service';

test('isValidUncPath requires a UNC server', () => {
  assert.equal(isValidUncPath('192.168.0.142'), false);
  assert.equal(isValidUncPath('nas.example.local'), false);
  assert.equal(isValidUncPath('\\\\nas.example.local'), true);
  assert.equal(isValidUncPath('\\\\192.168.0.142'), true);
  assert.equal(isValidUncPath('\\\\nas.example.local\\Photos'), true);
  assert.equal(isValidUncPath('\\\\192.0.2.10\\Archive\\2026'), true);
});

test('isValidUncPath rejects forward slashes and relative segments', () => {
  assert.equal(isValidUncPath('//nas.example.local/Photos'), false);
  assert.equal(isValidUncPath('\\\\nas.example.local\\Photos\\..\\Archive'), false);
});
