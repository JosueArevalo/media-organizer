import fs from 'node:fs';
import path from 'node:path';

const MAX_LOG_FILES = 5;
const MAX_RECENT_LINES = 200;

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
  const filePath = path.join(logsDir, `desktop-${timestamp}.log`);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  const recentLines: string[] = [];
  const write = (scope: string, value: string) => {
    const line = `${new Date().toISOString()} [${scope}] ${value.trimEnd()}`;
    recentLines.push(line);
    if (recentLines.length > MAX_RECENT_LINES) recentLines.splice(0, recentLines.length - MAX_RECENT_LINES);
    stream.write(`${line}\n`);
  };

  return {
    pipe(scope: string, source: NodeJS.ReadableStream | null) {
      source?.on('data', (chunk: unknown) => write(scope, Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)));
    },
    write,
    filePath,
    getTail: () => recentLines.join('\n'),
    close: () => stream.end()
  };
};
