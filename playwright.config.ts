import { defineConfig } from '@playwright/test';

const fixtureBaseUrl = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './tests/interaction',
  outputDir: '.playwright-results',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: fixtureBaseUrl,
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'firefox',
      testMatch: /.*\.firefox\.spec\.ts/,
      use: { browserName: 'firefox' }
    },
    {
      name: 'electron',
      testMatch: /.*\.electron\.spec\.ts/
    }
  ],
  webServer: {
    command: 'npm run dev --workspace apps/web -- --host 127.0.0.1 --port 4174 --strictPort',
    url: `${fixtureBaseUrl}/tests/interaction/grouping-move-menu.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
