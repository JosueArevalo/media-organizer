import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(process.cwd());
const releaseDir = path.resolve(workspaceRoot, 'release');
const relative = path.relative(workspaceRoot, releaseDir);

if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error(`Refusing to clean an unsafe release path: ${releaseDir}`);
}

fs.rmSync(releaseDir, { recursive: true, force: true });
console.log(`Cleaned ${releaseDir}`);
