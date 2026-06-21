import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-desktop-smoke-'));
const userData = path.join(temp, 'user-data');

const run = (name, value, expected = '') => new Promise((resolve, reject) => {
  const report = path.join(temp, `${name}.json`);
  const child = spawn(electron, [root, `--user-data-dir=${userData}`], {
    cwd: root,
    env: {
      ...process.env,
      MEDIA_ORGANIZER_SMOKE_REPORT: report,
      MEDIA_ORGANIZER_SMOKE_VALUE: value,
      ...(expected ? { MEDIA_ORGANIZER_SMOKE_EXPECT: expected } : {})
    },
    stdio: 'inherit',
    windowsHide: true
  });
  child.once('error', reject);
  child.once('exit', (code) => {
    if (code !== 0) return reject(new Error(`Desktop smoke run exited with ${code}.`));
    resolve(JSON.parse(fs.readFileSync(report, 'utf8')));
  });
});

const first = await run('first', 'persisted');
assert.equal(first.status, 200);
assert.equal(first.runtime.mode, 'desktop');
const second = await run('second', 'persisted', 'persisted');
assert.equal(second.previous, 'persisted');
console.log('Desktop smoke test passed.');
