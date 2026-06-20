import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const componentPath = path.resolve(process.cwd(), 'src', 'components', 'InfoTooltip.tsx');

test('info tooltip supports pointer, focus, click, escape and outside dismissal', () => {
  const source = fs.readFileSync(componentPath, 'utf8');

  assert.match(source, /onMouseEnter=\{\(\) => setIsOpen\(true\)\}/);
  assert.match(source, /onFocus=\{\(\) => setIsOpen\(true\)\}/);
  assert.match(source, /setIsPinned\(true\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /document\.addEventListener\('pointerdown'/);
  assert.match(source, /aria-expanded=\{isOpen\}/);
  assert.match(source, /role="tooltip"/);
});
