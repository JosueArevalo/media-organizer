import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveDesktopExecutable } from './desktop-smoke-utils.mjs';

const root = process.cwd();
const require = createRequire(import.meta.url);
const { executable, portableExecutable, source } = resolveDesktopExecutable({
  argv: process.argv.slice(2),
  workingDirectory: root,
  electronResolver: () => require('electron')
});

if (!fs.existsSync(executable)) {
  throw new Error(
    `Desktop executable was not found: ${executable}. Pass --executable <path> to smoke a packaged build or ensure the electron package resolves a valid development executable.`
  );
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-desktop-smoke-'));
const userData = path.join(temp, 'user-data');

const run = (name, value, expected = '') => new Promise((resolve, reject) => {
  const report = path.join(temp, `${name}.json`);
  const launchArgs = portableExecutable
    ? [`--user-data-dir=${userData}`, '--disable-gpu']
    : [root, `--user-data-dir=${userData}`, '--disable-gpu'];
  const child = spawn(executable, launchArgs, {
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
assert.equal(first.rendered, true);
assert.equal(first.bridgeAvailable, true);
assert.equal(first.backendState?.status, 'online');
const second = await run('second', 'persisted', 'persisted');
assert.equal(second.previous, 'persisted');
assert.equal(second.rendered, true);
assert.equal(second.bridgeAvailable, true);
assert.equal(second.backendState?.status, 'online');
console.log(`Desktop smoke test passed (${source} executable).`);
