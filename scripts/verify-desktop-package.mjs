import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const preloadPath = path.resolve('apps', 'desktop', 'dist', 'preload.cjs');
assert.ok(fs.existsSync(preloadPath), 'CommonJS preload was not generated.');
const preloadSource = fs.readFileSync(preloadPath, 'utf8');
assert.match(preloadSource, /require\(["']electron["']\)/, 'Preload must load Electron through CommonJS.');
assert.doesNotMatch(preloadSource, /^\s*import\s/m, 'Preload must not contain ESM imports.');

const resources = path.resolve('release', 'win-unpacked', 'resources');
const requiredPaths = [
  'backend/dist/desktop.js',
  'backend/dist/pipeline/compression/orientedJpegCompression.cli.js',
  'backend/package.json',
  'backend/node_modules/sharp/package.json',
  'backend/node_modules/@img/colour/package.json',
  'backend/node_modules/@img/sharp-win32-x64/package.json',
  'backend/node_modules/detect-libc/package.json',
  'backend/node_modules/semver/package.json',
  'web/index.html',
  'worker/media-organizer-worker/media-organizer-worker.exe'
];

for (const relativePath of requiredPaths) {
  const packagedPath = path.join(resources, ...relativePath.split('/'));
  assert.ok(fs.existsSync(packagedPath), `Packaged resource is missing: ${relativePath}`);
}

const portableCandidates = fs.readdirSync(path.resolve('release'))
  .filter((name) => /^Media-Organizer-.*-windows-x64-portable\.exe$/i.test(name));
assert.equal(portableCandidates.length, 1, 'Expected exactly one freshly generated Windows portable executable.');

const portablePath = path.resolve('release', portableCandidates[0]);
const portableStats = fs.statSync(portablePath);
assert.ok(portableStats.size > 10 * 1024 * 1024, 'Portable executable is unexpectedly small.');
const header = Buffer.alloc(2);
const handle = fs.openSync(portablePath, 'r');
try {
  fs.readSync(handle, header, 0, header.length, 0);
} finally {
  fs.closeSync(handle);
}
assert.equal(header.toString('ascii'), 'MZ', 'Portable artifact does not have a Windows PE header.');

console.log('Packaged desktop resources verified.');
