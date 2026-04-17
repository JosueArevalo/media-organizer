import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { platform } from 'node:process';

const workspaceRoot = 'd:/Software Development/media-organizer';
const devServerUrl = 'http://127.0.0.1:4173';

const startDevServer = async () => {
  const command = platform === 'win32' ? 'cmd.exe' : 'npm';
  const args =
    platform === 'win32'
      ? ['/d', '/s', '/c', 'npm run dev --workspace apps/web -- --host 127.0.0.1 --port 4173 --strictPort']
      : ['run', 'dev', '--workspace', 'apps/web', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'];

  const childProcess = spawn(command, args, {
    cwd: workspaceRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const ready = new Promise<void>((resolve, reject) => {
    const handleOutput = (chunk: Buffer) => {
      const output = chunk.toString('utf8');
      if (output.includes('Local:') || output.includes('ready in')) {
        resolve();
      }
    };

    childProcess.stdout?.on('data', handleOutput);
    childProcess.stderr?.on('data', handleOutput);
    childProcess.on('error', reject);
    childProcess.on('exit', (code: number | null) => {
      if (code !== null && code !== 0) {
        reject(new Error(`Dev server exited before it became ready (code ${code}).`));
      }
    });
  });

  await Promise.race([ready, delay(10000).then(() => {
    throw new Error('Timed out waiting for the web dev server to start.');
  })]);

  return childProcess;
};

test('dashboard route loads and the client module compiles', async () => {
  const devServer = await startDevServer();

  try {
    const dashboardResponse = await fetch(`${devServerUrl}/dashboard`);
    assert.equal(dashboardResponse.status, 200, 'Dashboard route should respond with HTTP 200');

    const dashboardHtml = await dashboardResponse.text();
    assert.match(dashboardHtml, /id="root"/, 'Dashboard HTML should contain the app root');

    for (const pageModule of [
      '/src/main.tsx',
      '/src/App.tsx',
      '/src/pages/DashboardPage.tsx',
      '/src/pages/ImportPage.tsx',
      '/src/pages/PreviewPage.tsx',
      '/src/pages/CompressionPage.tsx',
      '/src/pages/GroupingPage.tsx'
    ]) {
      const moduleResponse = await fetch(`${devServerUrl}${pageModule}`);
      const moduleBody = await moduleResponse.text();

      assert.ok(
        moduleResponse.ok,
        `Expected ${pageModule} to compile, but Vite returned ${moduleResponse.status}:\n${moduleBody}`
      );
    }
  } finally {
    devServer.kill('SIGTERM');
  }
});