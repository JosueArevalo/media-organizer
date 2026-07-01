import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type ToolCommandResolverOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homebrewPrefixes?: string[];
};

const homebrewFormulaByCommand: Record<string, string> = {
  cjpeg: 'mozjpeg',
  pngquant: 'pngquant',
  magick: 'imagemagick',
  exiftool: 'exiftool',
  HandBrakeCLI: 'handbrake'
};

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

const resolveFromSystemPath = (
  commandName: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
) => {
  const trimmed = commandName.trim();

  if (!trimmed) {
    return null;
  }

  const lookupProgram = platform === 'win32' ? 'where' : 'which';
  const lookup = spawnSync(lookupProgram, [trimmed], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
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

const getDefaultHomebrewPrefixes = (platform: NodeJS.Platform) => {
  if (platform === 'linux') {
    return ['/home/linuxbrew/.linuxbrew'];
  }

  if (platform === 'darwin') {
    return ['/opt/homebrew', '/usr/local'];
  }

  return [];
};

const uniqueExistingPrefixes = (prefixes: Array<string | null>) =>
  [...new Set(prefixes.filter((prefix): prefix is string => Boolean(prefix)))]
    .filter((prefix) => fs.existsSync(prefix));

const runBrewPrefix = (
  brewCommand: string,
  formula: string | null,
  env: NodeJS.ProcessEnv
) => {
  const result = spawnSync(brewCommand, formula ? ['--prefix', formula] : ['--prefix'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    shell: false
  });

  if (result.status !== 0) {
    return null;
  }

  const prefix = (result.stdout ?? '').trim().split(/\r?\n/, 1)[0]?.trim();
  return prefix || null;
};

const resolveFromHomebrew = (
  commandName: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  configuredPrefixes?: string[]
) => {
  const formula = homebrewFormulaByCommand[commandName];
  if (!formula || (platform !== 'linux' && platform !== 'darwin')) {
    return null;
  }

  const defaultPrefixes = getDefaultHomebrewPrefixes(platform);
  const initialPrefixes = configuredPrefixes ?? defaultPrefixes;
  const brewFromPath = resolveFromSystemPath('brew', platform, env);
  const brewCandidates = [
    brewFromPath,
    ...initialPrefixes.map((prefix) => path.join(prefix, 'bin', 'brew'))
  ].filter((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)));
  const queriedPrefixes = brewCandidates.flatMap((brewCommand) => [
    runBrewPrefix(brewCommand, null, env),
    runBrewPrefix(brewCommand, formula, env)
  ]);
  const prefixes = uniqueExistingPrefixes([
    ...initialPrefixes,
    ...queriedPrefixes
  ]);

  for (const prefix of prefixes) {
    const candidates = [
      path.join(prefix, 'bin', commandName),
      path.join(prefix, 'opt', formula, 'bin', commandName)
    ];

    for (const candidate of candidates) {
      const resolved = resolveAbsoluteIfExists(candidate);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
};

export const resolveToolCommand = (
  command: string | null | undefined,
  options: ToolCommandResolverOptions = {}
) => {
  const trimmed = command?.trim();

  if (!trimmed) {
    return null;
  }

  if (hasPathSeparator(trimmed)) {
    return resolveAbsoluteIfExists(trimmed);
  }

  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  return resolveFromSystemPath(trimmed, platform, env)
    ?? resolveFromHomebrew(trimmed, platform, env, options.homebrewPrefixes);
};
