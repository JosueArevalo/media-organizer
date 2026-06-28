import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const readSource = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), 'utf8');

test('dashboard wires the welcome onboarding panel and persists dismissal', () => {
  const dashboardPage = readSource('src/pages/DashboardPage.tsx');
  const panel = readSource('src/components/DashboardWelcomePanel.tsx');
  const styles = readSource('src/styles.css');

  assert.match(dashboardPage, /DashboardWelcomePanel/);
  assert.match(dashboardPage, /shouldShowOnboarding/);
  assert.match(dashboardPage, /dismissOnboarding\(\)/);
  assert.match(dashboardPage, /showOnboarding &&/);

  assert.match(panel, /to="\/settings"/);
  assert.match(panel, /to="\/import"/);
  assert.match(panel, /dashboard-onboarding-close/);
  assert.match(styles, /\.dashboard-onboarding \{/);
  assert.match(styles, /\.dashboard-onboarding-steps \{/);
});
