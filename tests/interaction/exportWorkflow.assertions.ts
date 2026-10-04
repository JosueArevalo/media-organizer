import { expect, type Page, type Route } from '@playwright/test';

type Provider = 'google-photos' | 'network-folder';
type Item = { id: string; jobId: string; relativePath: string; sourcePath: string; destinationPath: string;
  status: string; sizeBytes: number; lastError: string | null; updatedAt: string; attemptCount: number };
type Job = { job: { id: string; sourceRoot: string; targetType: Provider; targetPath: string | null;
  status: string; totalItems: number; completedItems: number; failedItems: number; skippedItems: number;
  eligibleItems: number; eligibleAlbums: number; executionId: string; destinationLabel: string; updatedAt: string };
  checkpoint: { payloadJson: string }; recentItems: Item[] };

const sourceRoot = 'C:/export-source';
const destinationPath = '\\\\nas\\share\\export';
const account = { id: 'account-1', email: 'one@example.com', displayName: 'Account one' };
const groupId = (provider: Provider, label: string) => `${provider === 'google-photos' ? 'album' : 'folder'}:${label}`;

export const installExportMock = async (page: Page, provider: Provider, initial?: 'paused' | 'failed' | 'completed') => {
  const jobs: Job[] = [];
  const createdTargets: Array<Record<string, unknown>> = [];
  const starts: string[] = [];
  const scopes: string[][] = [];
  const completed = new Set<string>();
  let holdScope: Promise<void> | null = null;
  let releaseScope: (() => void) | null = null;
  let failScope = false;
  let failJobReads = false;
  let pendingScopeRequests = 0;
  let maxScopeRequests = 0;
  let holdPreview: Promise<void> | null = null;
  let releasePreview: (() => void) | null = null;
  let previewStarted = false;
  let runnerActive = false;
  const targetFor = (labels = ['A', 'B'], accountId = account.id) => provider === 'google-photos'
    ? { type: provider, accountId, albumTitles: labels }
    : { type: provider, destinationPath, groupIds: labels.map((label) => groupId(provider, label)) };
  const makeJob = (target: Record<string, unknown>) => {
    const labels = (provider === 'google-photos' ? target.albumTitles as string[] : (target.groupIds as string[]).map((id) => id.slice(7))) ?? ['A', 'B'];
    const id = `job-${jobs.length + 1}`;
    const recentItems = labels.map((label, index) => ({ id: `${id}-${index}`, jobId: id, relativePath: `${label}/file.jpg`,
      sourcePath: `${sourceRoot}/${label}/file.jpg`, destinationPath: provider === 'google-photos' ? label : `${destinationPath}/${label}/file.jpg`,
      status: 'pending', sizeBytes: 5, lastError: null, updatedAt: new Date().toISOString(), attemptCount: 0 }));
    const job: Job = { job: { id, sourceRoot, targetType: provider, targetPath: provider === 'network-folder' ? destinationPath : null,
      status: 'draft', totalItems: labels.length, completedItems: 0, failedItems: 0, skippedItems: 0,
      eligibleItems: 2, eligibleAlbums: provider === 'google-photos' ? labels.length : 0,
      executionId: 'execution-1', destinationLabel: provider === 'google-photos' ? account.email : destinationPath,
      updatedAt: new Date().toISOString() }, checkpoint: { payloadJson: JSON.stringify({ target }) }, recentItems };
    jobs.unshift(job);
    return job;
  };
  if (initial) {
    const job = makeJob(targetFor(initial === 'completed' ? ['A'] : ['A', 'B']));
    job.job.status = initial;
    if (initial === 'failed') { job.job.failedItems = 1; job.recentItems[0].status = 'failed'; job.recentItems[0].lastError = 'Network lost'; }
    if (initial === 'completed') { job.job.completedItems = 1; job.recentItems[0].status = 'completed'; completed.add('A'); }
  }
  await page.addInitScript(({ sourceRoot }) => {
    window.localStorage.setItem('mediaOrganizer.locale', 'en');
    window.localStorage.setItem('media-organizer-grouping-session', JSON.stringify({
      backendSessionId: 'grouping-1', status: 'completed', outputRootLabel: sourceRoot, updatedAt: Date.now()
    }));
  }, { sourceRoot });
  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = route.request().postDataJSON() as Record<string, any> | null;
    const reply = (json: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (url.pathname === '/api/export/google-photos/config') return reply({ configured: true, source: 'local-db', redirectUri: 'http://localhost/callback' });
    if (url.pathname === '/api/export/google-photos/accounts') return reply({ accounts: [account, { id: 'account-2', email: 'two@example.com', displayName: 'Account two' }] });
    if (url.pathname === '/api/export/network-destinations') return reply({ destinations: [
      { id: 'nas-1', name: 'NAS', rootPath: destinationPath },
      { id: 'nas-2', name: 'Second NAS', rootPath: '\\\\nas\\share\\second' }
    ] });
    if (url.pathname === '/api/export/targets/test') return reply({ ok: true, message: 'Access available', targetType: provider });
    if (url.pathname === '/api/export/preview') {
      const requestAccount = body?.target?.accountId;
      const requestSource = body?.sourceRoot;
      const requestDestination = body?.target?.destinationPath;
      previewStarted = true;
      if (holdPreview) await holdPreview;
      const labels = requestSource !== sourceRoot ? ['Other source']
        : requestDestination && requestDestination !== destinationPath ? ['Other destination']
        : requestAccount === 'account-2' ? ['Other account'] : ['A', 'B'];
      return reply({ supportedItems: labels.length, unsupportedItems: 0, groups: labels.map((label) => {
        const item = jobs.flatMap((job) => job.recentItems).find((entry) => entry.relativePath.startsWith(label + '/'));
        return { id: groupId(provider, label), label, destinationStatus: provider === 'google-photos' ? 'new' : undefined,
          exportStatus: completed.has(label) ? 'completed' : 'pending', itemCount: 1,
          items: [{ relativePath: label + '/file.jpg', sizeBytes: 5, supported: true,
            id: item?.id, jobId: item?.jobId, status: completed.has(label) ? 'completed' : item?.status ?? 'pending', lastError: item?.lastError }] };
      }) });
    }
    if (url.pathname === '/api/export/jobs') {
      if (method === 'GET') return reply({ jobs });
      const target = body!.target as Record<string, unknown>;
      createdTargets.push(target);
      return reply(makeJob(target), 201);
    }
    const segments = url.pathname.split('/');
    const job = jobs.find((candidate) => candidate.job.id === segments[4]);
    if (!job) return reply({ message: 'Unexpected mocked request: ' + url.pathname }, 404);
    const action = segments[5];
    if (!action) return failJobReads ? reply({ message: 'Could not restore selection' }, 503) : reply(job);
    if (action === 'progress') return reply({
      jobId: job.job.id, status: job.job.status, total: job.job.totalItems, completed: job.job.completedItems,
      failed: job.job.failedItems, skipped: job.job.skippedItems,
      pending: job.job.totalItems - job.job.completedItems - job.job.failedItems,
      recentItems: job.recentItems,
      runnerActive,
      groupProgress: job.recentItems.map((item) => ({ groupId: groupId(provider, item.relativePath.split('/')[0]),
        total: 1, completed: item.status === 'completed' ? 1 : 0, failed: item.status === 'failed' ? 1 : 0,
        skipped: 0, pending: item.status === 'pending' || item.status === 'running' ? 1 : 0, status: item.status }))
    });
    if (action === 'start' || action === 'retry-failed') {
      starts.push(job.job.id); job.job.status = 'running'; job.job.failedItems = 0;
      for (const item of job.recentItems) if (item.status !== 'completed') { item.status = 'pending'; item.lastError = null; }
      return reply(job, 202);
    }
    if (action === 'pause') { job.job.status = 'paused'; return reply(job); }
    if (action === 'scope') {
      pendingScopeRequests++; maxScopeRequests = Math.max(maxScopeRequests, pendingScopeRequests);
      scopes.push(body!.groupIds);
      if (holdScope) await holdScope;
      pendingScopeRequests--;
      if (failScope) { failScope = false; return reply({ message: 'Could not save selection' }, 503); }
      const target = JSON.parse(job.checkpoint.payloadJson).target;
      const nextTarget = provider === 'google-photos' ? { ...target, albumTitles: body!.groupIds.map((id: string) => id.slice(6)) }
        : { ...target, groupIds: body!.groupIds };
      const labels = provider === 'google-photos' ? nextTarget.albumTitles : nextTarget.groupIds.map((id: string) => id.slice(7));
      job.recentItems = labels.map((label: string, i: number) => ({ id: `${job.job.id}-${i}`, jobId: job.job.id,
        relativePath: `${label}/file.jpg`, sourcePath: `${sourceRoot}/${label}/file.jpg`, destinationPath: label,
        sizeBytes: 5, status: 'pending', lastError: null, updatedAt: new Date().toISOString(), attemptCount: 0 }));
      job.job.totalItems = labels.length; job.checkpoint.payloadJson = JSON.stringify({ target: nextTarget });
      return reply(job);
    }
    if (action === 'items') {
      const item = job.recentItems.find((entry) => entry.id === segments[6])!;
      item.status = 'pending'; item.lastError = null; job.job.status = 'paused'; job.job.failedItems = 0;
      return reply(job);
    }
    return reply({ message: 'Unexpected mocked action: ' + action }, 404);
  });
  return {
    jobs, createdTargets, starts, scopes,
    get maxScopeRequests() { return maxScopeRequests; },
    get previewStarted() { return previewStarted; },
    setRunnerActive: (value: boolean) => { runnerActive = value; },
    holdNextScope: () => { holdScope = new Promise<void>((resolve) => { releaseScope = resolve; }); },
    releaseScope: () => { releaseScope?.(); holdScope = null; },
    failNextScope: () => { failScope = true; },
    setJobReadsUnavailable: (value: boolean) => { failJobReads = value; },
    holdNextPreview: () => { previewStarted = false; holdPreview = new Promise<void>((resolve) => { releasePreview = resolve; }); },
    releasePreview: () => { releasePreview?.(); holdPreview = null; },
    complete: () => {
      const job = jobs[0]; job.job.status = 'completed'; job.job.completedItems = job.job.totalItems;
      for (const item of job.recentItems) { item.status = 'completed'; completed.add(item.relativePath.split('/')[0]); }
    }
  };
};

const openExport = async (page: Page, url: string, provider: Provider) => {
  await page.goto(url + '?provider=' + provider);
  if (provider === 'network-folder') {
    await page.getByRole('button', { name: /^NAS/ }).click();
    await page.getByRole('button', { name: 'Test access', exact: true }).click();
  }
};

export const verifyExportSelection = async (page: Page, url: string, provider: Provider) => {
  const mock = await installExportMock(page, provider);
  await openExport(page, url, provider);
  await page.getByRole('button', { name: provider === 'google-photos' ? 'Preview albums' : 'Preview', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'A', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'B', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'A', exact: true }).uncheck();
  const start = page.getByRole('button', { name: provider === 'google-photos' ? 'Upload selected albums' : 'Export selected folders', exact: true });
  await expect(start).toBeDisabled();
  expect(mock.createdTargets).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'A', exact: true }).check();
  await page.screenshot({ path: `.playwright-results/export-preview-${provider}-${page.context().browser()?.browserType().name() ?? 'electron'}.png`, fullPage: true });
  await start.click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true }).first()).toBeEnabled();
  expect(mock.createdTargets).toHaveLength(1);
  expect(provider === 'google-photos' ? mock.createdTargets[0].albumTitles : mock.createdTargets[0].groupIds)
    .toEqual([provider === 'google-photos' ? 'A' : 'folder:A']);
  await expect(page.getByRole('checkbox', { name: 'B', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Resume export', exact: true }).first()).toBeEnabled();
  const startsBeforeReload = mock.starts.length;
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'B', exact: true }).first()).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'A', exact: true }).first()).toBeChecked();
  expect(mock.starts).toHaveLength(startsBeforeReload);
  await page.getByRole('button', { name: 'Resume export', exact: true }).first().click();
  await expect.poll(() => mock.starts.length).toBe(startsBeforeReload + 1);
};

export const verifyExportScopeQueue = async (page: Page, url: string, provider: Provider) => {
  const mock = await installExportMock(page, provider, 'paused');
  await openExport(page, url, provider);
  await expect(page.getByRole('checkbox', { name: 'A', exact: true }).first()).toBeEnabled();
  mock.holdNextScope();
  await page.getByRole('checkbox', { name: 'B', exact: true }).first().uncheck();
  await expect.poll(() => mock.scopes.length).toBe(1);
  await page.getByRole('checkbox', { name: 'A', exact: true }).first().uncheck();
  await expect(page.getByRole('button', { name: 'Resume export', exact: true }).first()).toBeDisabled();
  expect(mock.scopes).toHaveLength(1);
  mock.releaseScope();
  await expect.poll(() => mock.scopes.length).toBe(2);
  expect(mock.maxScopeRequests).toBe(1);
  expect(mock.scopes[1]).toEqual([]);
  await expect(page.getByRole('checkbox', { name: 'A', exact: true }).first()).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Resume export', exact: true }).first()).toBeDisabled();
  mock.failNextScope();
  await page.getByRole('checkbox', { name: 'A', exact: true }).first().check();
  await expect(page.getByRole('alert')).toContainText('Could not save selection');
  await expect(page.getByRole('checkbox', { name: 'A', exact: true }).first()).not.toBeChecked();
  expect(mock.starts).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'A', exact: true }).first().check();
  const resume = page.getByRole('button', { name: 'Resume export', exact: true }).first();
  await expect(resume).toBeEnabled();
  mock.failNextScope();
  mock.setJobReadsUnavailable(true);
  await page.getByRole('checkbox', { name: 'B', exact: true }).first().check();
  await expect(page.getByRole('alert')).toContainText('Could not restore selection');
  await expect(resume).toBeDisabled();
  expect(mock.starts).toHaveLength(0);
  mock.setJobReadsUnavailable(false);
  await page.getByRole('checkbox', { name: 'B', exact: true }).first().uncheck();
  await expect(resume).toBeEnabled();
};

export const verifyExportFollowup = async (page: Page, url: string, provider: Provider) => {
  const mock = await installExportMock(page, provider, 'completed');
  await openExport(page, url, provider);
  await expect(page.getByRole('checkbox', { name: 'A', exact: true }).first()).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'B', exact: true }).first()).toBeChecked();
  await page.getByRole('button', { name: provider === 'google-photos' ? 'Upload selected albums' : 'Export selected folders', exact: true }).click();
  await expect.poll(() => mock.createdTargets.length).toBe(1);
  expect(provider === 'google-photos' ? mock.createdTargets[0].albumTitles : mock.createdTargets[0].groupIds)
    .toEqual([provider === 'google-photos' ? 'B' : 'folder:B']);
  expect(mock.jobs).toHaveLength(2);
  expect(mock.jobs[1].job.status).toBe('completed');
};

export const verifyExportAccountIsolation = async (page: Page, url: string) => {
  const mock = await installExportMock(page, 'google-photos');
  await openExport(page, url, 'google-photos');
  mock.holdNextPreview();
  await page.getByRole('button', { name: 'Preview albums', exact: true }).click();
  await expect.poll(() => mock.previewStarted).toBe(true);
  await page.getByRole('button', { name: /2\. Google Photos account/ }).click();
  await page.getByRole('button', { name: /Account two/ }).click();
  mock.releasePreview();
  const albumsSection = page.getByRole('button', { name: /3\. Albums and upload/ });
  if (await albumsSection.getAttribute('aria-expanded') === 'false') await albumsSection.click();
  await page.getByRole('button', { name: 'Preview albums', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Other account', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'A', exact: true })).toHaveCount(0);
  expect(mock.starts).toHaveLength(0);
};

export const verifyExportRetry = async (page: Page, url: string, provider: Provider) => {
  const mock = await installExportMock(page, provider, 'failed');
  await openExport(page, url, provider);
  await page.getByRole('button', { name: 'Retry failed', exact: true }).first().click();
  await expect.poll(() => mock.starts.length).toBe(1);
  expect(mock.createdTargets).toHaveLength(0);
};

export const verifyPausedRunner = async (page: Page, url: string, provider: Provider) => {
  const mock = await installExportMock(page, provider, 'paused');
  mock.setRunnerActive(true);
  await openExport(page, url, provider);
  await expect(page.getByRole('checkbox', { name: 'B', exact: true }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Resume export', exact: true }).first()).toBeDisabled();
  mock.setRunnerActive(false);
  await expect(page.getByRole('checkbox', { name: 'B', exact: true }).first()).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Resume export', exact: true }).first()).toBeEnabled();
  expect(mock.starts).toHaveLength(0);
};

export const verifyExportContextIsolation = async (page: Page, url: string, provider: Provider) => {
  const mock = await installExportMock(page, provider);
  await openExport(page, url, provider);
  mock.holdNextPreview();
  const previewButton = () => page.getByRole('button', { name: provider === 'google-photos' ? 'Preview albums' : 'Preview', exact: true });
  await previewButton().click();
  await expect.poll(() => mock.previewStarted).toBe(true);
  await page.getByRole('button', { name: 'Change source context' }).click();
  mock.releasePreview();
  await previewButton().click();
  await expect(page.getByRole('checkbox', { name: 'Other source', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'A', exact: true })).toHaveCount(0);
  expect(mock.starts).toHaveLength(0);
};

export const verifyNetworkDestinationIsolation = async (page: Page, url: string) => {
  const mock = await installExportMock(page, 'network-folder');
  await openExport(page, url, 'network-folder');
  mock.holdNextPreview();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.poll(() => mock.previewStarted).toBe(true);
  await page.getByRole('button', { name: /^Second NAS/ }).click();
  mock.releasePreview();
  await page.getByRole('button', { name: 'Test access', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Other destination', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'A', exact: true })).toHaveCount(0);
  expect(mock.starts).toHaveLength(0);
};
