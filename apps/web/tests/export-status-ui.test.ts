import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const pagesRoot = path.resolve(process.cwd(), 'src', 'pages');
const hooksRoot = path.resolve(process.cwd(), 'src', 'hooks');

test('export hub only renders the completion check for complete coverage', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'ExportPage.tsx'), 'utf8');
  assert.match(source, /displayStatus === 'completed'/);
  assert.match(source, /export-provider-check/);
  assert.match(source, /export\.coverage\.items/);
  assert.match(source, /export\.coverage\.albums/);
  assert.match(source, /export\.coverage\.attention/);
});

test('dashboard renders persisted provider summaries and completed destinations', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'DashboardPage.tsx'), 'utf8');
  assert.match(source, /ExportSummary exports=\{execution\.exports\}/);
  assert.match(source, /completedDestinations\.slice/);
  assert.match(source, /dashboard\.exportLastAttempt/);
  assert.match(source, /dashboard-export-row/);
  assert.match(source, /summary\.displayStatus/);
  assert.doesNotMatch(source, /destination\.completedJobs/);
  assert.doesNotMatch(source, /dashboard-export-provider dashboard-export-provider-/);
});

test('saved executions header labels source and destination without arrows or a paths section', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'DashboardPage.tsx'), 'utf8');

  assert.match(source, /dashboard-execution-path-summary/);
  assert.match(source, /t\('dashboard\.source'\)\}:<\/strong>/);
  assert.match(source, /t\('dashboard\.destination'\)\}:<\/strong>/);
  assert.doesNotMatch(source, /getExecutionTitle|className="job-title"/);
  assert.doesNotMatch(source, /title=\{t\('dashboard\.paths'\)\}/);
  assert.doesNotMatch(source, /navigator\.clipboard|handleCopyPath|dashboard-path-row/);
  assert.doesNotMatch(source, /aria-hidden="true">→/);
});

test('compression uses aligned sizes, timing, and profiles rows', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'DashboardPage.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(process.cwd(), 'src', 'styles.css'), 'utf8');
  const sizesIndex = source.indexOf('dashboard-compression-row-sizes');
  const timingIndex = source.indexOf('dashboard-compression-row-timing');
  const profilesIndex = source.indexOf('dashboard-compression-row-profiles');

  assert.ok(sizesIndex >= 0);
  assert.ok(timingIndex > sizesIndex);
  assert.ok(profilesIndex > timingIndex);
  assert.match(source, /dashboard\.imageCompression/);
  assert.match(source, /formatImageCompression\(execution\.imageProfileLabel, execution\.imageQuality\)/);
  assert.match(source, /`\$\{label\} \(\$\{quality\}\)`/);
  assert.match(source, /dashboard\.handBrakePreset/);
  assert.doesNotMatch(source.slice(sizesIndex, timingIndex), /aria-hidden="true"/);
  assert.match(styles, /\.dashboard-compression-row\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.dashboard-compression-row strong\s*\{[\s\S]*font-size: 12px/);
  assert.match(styles, /\.dashboard-compression-row:first-of-type\s*\{[\s\S]*padding-top: 8px/);
});

test('completed organization hides progress while incomplete organization shows it', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'DashboardPage.tsx'), 'utf8');
  const english = fs.readFileSync(path.resolve(process.cwd(), 'src', 'i18n', 'locales', 'en.ts'), 'utf8');
  const organizationStart = source.indexOf('className="dashboard-organization-head"');
  const organizationEnd = source.indexOf('<ExportSummary exports={execution.exports}', organizationStart);
  const organizationSource = source.slice(organizationStart, organizationEnd);

  assert.match(source, /execution\.groupingStatus !== 'completed'/);
  assert.match(source, /dashboard\.organizationProgress/);
  assert.match(source, /dashboard\.organizationFailed/);
  assert.match(organizationSource, /className="dashboard-organization-description"/);
  assert.doesNotMatch(organizationSource, /<strong>/);
  assert.match(english, /destination media count matches the expected output/);
});

test('destination verification is compact when correct and compares counts on mismatch', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'DashboardPage.tsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(process.cwd(), 'src', 'styles.css'), 'utf8');

  assert.match(source, /const isMismatch = verification\.status === 'mismatch'/);
  assert.match(source, /verification\.verifiedMedia/);
  assert.match(source, /isMismatch \?/);
  assert.match(styles, /\.verification-panel-ok\s*\{[\s\S]*background: transparent;/);
});

test('provider pages consume only their own active export snapshot', () => {
  const networkSource = fs.readFileSync(path.join(pagesRoot, 'NetworkFolderExportPage.tsx'), 'utf8');
  const googleSource = fs.readFileSync(path.join(pagesRoot, 'GooglePhotosExportPage.tsx'), 'utf8');

  assert.match(networkSource, /useExportJobState\('network-folder'/);
  assert.match(googleSource, /useExportJobState\('google-photos'/);
});

test('network export uses shared preview and retains destination-specific history', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'NetworkFolderExportPage.tsx'), 'utf8');
  const history = fs.readFileSync(path.resolve('src/components/ExportJobHistoryCard.tsx'), 'utf8');
  assert.match(source, /listExportJobsRequest/);
  assert.match(source, /ExportWorkflowPanel workflow=\{workflow\} provider="network-folder"/);
  assert.match(source, /ExportJobHistoryCard/);
  assert.match(source, /normalizeNetworkPathForComparison/);
  assert.match(history, /fixedJobId: snapshot\.job\.id/);
  assert.match(history, /job\.targetPath \?\? job\.destinationLabel/);
});

test('network export keeps Windows authentication and adds mounted-folder flow for Unix', () => {
  const source = fs.readFileSync(path.join(pagesRoot, 'NetworkFolderExportPage.tsx'), 'utf8');

  assert.match(source, /isWindows && <form className="network-step" onSubmit=\{handleAuthenticateSubmit\}/);
  assert.match(source, /handlePickMountedFolder/);
  assert.match(source, /pickDirectoryRequest/);
  assert.match(source, /export\.network\.mountedLocationNoteMac/);
  assert.match(source, /export\.network\.mountedLocationNoteLinux/);
  assert.match(source, /export\.network\.folderStepUnix/);
});

test('export completion notifications ignore paused jobs', () => {
  const source = fs.readFileSync(path.join(hooksRoot, 'useCompletionNotifications.ts'), 'utf8');
  const exportNotification = source.slice(source.indexOf('for (const exportJobState'));

  assert.match(exportNotification, /previousStatus !== 'completed'/);
  assert.match(exportNotification, /exportJobState\.status === 'completed'/);
  assert.match(exportNotification, /\(exportJobState\.totalItems \?\? 0\) > 0/);
  assert.match(source, /const getExportCompletionKey/);
  assert.match(source, /previousExportCompletionKeyRef/);
  assert.match(source, /'google-photos': getExportCompletionKey\(googlePhotosExportJobState\)/);
  assert.match(exportNotification, /const previousCompletionKey = previousExportCompletionKeyRef\.current\[exportJobState\.targetType\]/);
  assert.match(exportNotification, /previousExportCompletionKeyRef\.current\[exportJobState\.targetType\] = completionKey/);
  assert.match(exportNotification, /previousCompletionKey !== completionKey/);
  assert.doesNotMatch(exportNotification, /exportJobState\.status === 'paused'[\s\S]*notifyCompletion\('exportCompleted'/);
});
