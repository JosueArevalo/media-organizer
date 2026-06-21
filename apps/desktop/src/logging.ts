import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

const MAX_LOG_FILES = 5;

export const createDesktopLogger = (logsDir: string) => {
  fs.mkdirSync(logsDir, { recursive: true });
  const existing = fs.readdirSync(logsDir)
    .filter((name) => /^desktop-\d{4}-\d{2}-\d{2}T/.test(name))
    .sort()
    .reverse();

  for (const stale of existing.slice(MAX_LOG_FILES - 1)) {
    fs.rmSync(path.join(logsDir, stale), { force: true });
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const stream = fs.createWriteStream(path.join(logsDir, `desktop-${timestamp}.log`), { flags: 'a' });
  const write = (scope: string, value: string) => stream.write(`${new Date().toISOString()} [${scope}] ${value.trimEnd()}\n`);

  return {
    pipe(scope: string, source: Readable | null) {
      source?.setEncoding('utf8');
      source?.on('data', (chunk: string) => write(scope, chunk));
    },
    write,
    close: () => stream.end()
  };
};
