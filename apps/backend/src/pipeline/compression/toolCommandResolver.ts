import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const hasPathSeparator = (value: string) => value.includes('\\') || value.includes('/');

const resolveAbsoluteIfExists = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);

  if (!fs.existsSync(candidate)) {
    return null;
  }

  const stats = fs.statSync(candidate);
  return stats.isFile() ? candidate : null;
};

const resolveFromSystemPath = (commandName: string) => {
  const trimmed = commandName.trim();

  if (!trimmed) {
    return null;
  }

  const lookupProgram = process.platform === 'win32' ? 'where' : 'which';
  const lookup = spawnSync(lookupProgram, [trimmed], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false
  });

  if (lookup.status !== 0) {
    return null;
  }

  const stdout = (lookup.stdout ?? '').trim();
  if (!stdout) {
    return null;
  }

  const firstLine = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) {
    return null;
  }

  const resolved = firstLine.trim();
  return fs.existsSync(resolved) ? resolved : null;
};

export const resolveToolCommand = (command: string | null | undefined) => {
  const trimmed = command?.trim();

  if (!trimmed) {
    return null;
  }

  if (hasPathSeparator(trimmed)) {
    return resolveAbsoluteIfExists(trimmed);
  }

  return resolveFromSystemPath(trimmed);
};
