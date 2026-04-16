import { spawn } from 'node:child_process';

const childProcesses = [];

const run = (name, script) => {
  const child = spawn('npm', ['run', script], {
    stdio: 'inherit',
    shell: true,
    env: process.env
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[dev-all] ${name} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });

  childProcesses.push(child);
  return child;
};

const shutdown = (code = 0) => {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev-all] Starting backend and web...');
run('backend', 'dev:backend');
run('web', 'dev:web');
