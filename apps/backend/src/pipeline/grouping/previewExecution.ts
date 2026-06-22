import { spawn } from 'node:child_process';

export const createTaskQueue = (concurrency: number) => {
  let active = 0;
  const pending: Array<() => void> = [];
  const acquire = () => new Promise<void>((resolve) => {
    if (active < concurrency) {
      active += 1;
      resolve();
    } else {
      pending.push(() => {
        active += 1;
        resolve();
      });
    }
  });
  const release = () => {
    active -= 1;
    pending.shift()?.();
  };
  return async <T>(task: () => Promise<T>) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
};

export type CommandResult = { exitCode: number | null; stdout: string; stderr: string };

export const runCommand = (input: {
  command: string;
  args: string[];
  timeoutMs: number;
  shell?: boolean;
}) => new Promise<CommandResult>((resolve, reject) => {
  const child = spawn(input.command, input.args, {
    shell: input.shell ?? false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill();
    reject(new Error(`Command timed out after ${input.timeoutMs}ms.`));
  }, input.timeoutMs);
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.once('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(error);
  });
  child.once('exit', (exitCode) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve({
      exitCode,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    });
  });
});
