import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  getOnboardingToolState,
  shouldPrioritizeToolSetup
} from '../src/components/DashboardWelcomePanel';
import type { ToolPreflightState } from '../src/hooks/useToolPreflight';
import type { ExternalToolKey, ToolsStatusSnapshot } from '../src/services/tool-status.service';

const readSource = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), 'utf8');

const createPreflight = (
  status: ToolPreflightState['status'],
  toolStatuses: Partial<Record<ExternalToolKey, 'ready' | 'missing' | 'unknown'>> = {},
  pythonStatus: 'ready' | 'missing' = 'ready'
): ToolPreflightState => {
  const createTool = (key: ExternalToolKey) => ({
    key,
    label: key,
    effectiveCommand: key,
    resolvedPath: toolStatuses[key] === 'missing' ? null : key,
    status: toolStatuses[key] ?? 'ready',
    installCommand: null,
    installUrl: '',
    note: null
  });
  const snapshot: ToolsStatusSnapshot = {
    platform: 'win32',
    python: {
      command: 'python',
      resolvedPath: pythonStatus === 'ready' ? 'python' : null,
      status: pythonStatus,
      candidates: []
    },
    tools: {
      image: createTool('image'),
      imagemagick: createTool('imagemagick'),
      exiftool: createTool('exiftool'),
      video: createTool('video')
    }
  };

  return {
    status,
    settings: {
      imageToolCommand: '',
      videoToolCommand: '',
      imageMagickCommand: '',
      exifToolCommand: '',
      updatedAt: 0
    },
    snapshot: status === 'error' ? null : snapshot,
    error: status === 'error' ? 'Unavailable' : null,
    refresh: async () => snapshot
  };
};

test('dashboard wires the welcome onboarding panel and persists dismissal', () => {
  const dashboardPage = readSource('src/pages/DashboardPage.tsx');
  const panel = readSource('src/components/DashboardWelcomePanel.tsx');
  const styles = readSource('src/styles.css');

  assert.match(dashboardPage, /DashboardWelcomePanel/);
  assert.match(dashboardPage, /shouldShowOnboarding/);
  assert.match(dashboardPage, /dismissOnboarding\(\)/);
  assert.match(dashboardPage, /showOnboarding &&/);
  assert.match(dashboardPage, /!showOnboarding &&/);

  assert.match(panel, /to="\/settings"/);
  assert.match(panel, /to="\/import"/);
  assert.match(panel, /aria-label=\{t\('dashboard\.onboarding\.close'\)\}/);
  assert.match(panel, /MozJPEG/);
  assert.match(panel, /ImageMagick/);
  assert.match(panel, /ExifTool/);
  assert.match(panel, /HandBrakeCLI/);
  assert.doesNotMatch(panel, /dashboard-onboarding-steps/);
  assert.match(styles, /\.dashboard-onboarding \{/);
  assert.match(styles, /\.dashboard-onboarding-tools \{/);
  assert.doesNotMatch(styles, /\.dashboard-onboarding-steps \{/);
});

test('onboarding derives visible tool states from preflight', () => {
  assert.equal(getOnboardingToolState(createPreflight('loading'), 'image'), 'checking');
  assert.equal(getOnboardingToolState(createPreflight('ready', { image: 'missing' }), 'image'), 'missing');
  assert.equal(getOnboardingToolState(createPreflight('ready'), 'video'), 'ready');
  assert.equal(getOnboardingToolState(createPreflight('error'), 'imagemagick'), 'unknown');
});

test('onboarding prioritizes settings for core tools but not for ExifTool alone', () => {
  assert.equal(shouldPrioritizeToolSetup(createPreflight('ready', { image: 'missing' })), true);
  assert.equal(shouldPrioritizeToolSetup(createPreflight('ready', { video: 'missing' })), true);
  assert.equal(shouldPrioritizeToolSetup(createPreflight('ready', { exiftool: 'missing' })), false);
  assert.equal(shouldPrioritizeToolSetup(createPreflight('ready')), false);
  assert.equal(shouldPrioritizeToolSetup(createPreflight('ready', {}, 'missing')), true);
});
