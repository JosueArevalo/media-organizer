import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, beforeEach, test } from 'node:test';
import { createServer } from 'node:http';
import { getDb, resetDbForTests } from '../src/state/db.js';
import { runMigrations } from '../src/state/migrations/runMigrations.js';
import { cleanupTrackedTestTempDirectories, createTrackedTestTempDirectory } from '../../../test-utils/tempDirectory.js';
import { assertExportJobCanStart, createExportJob, getExportJob, getExportProgress, pauseExportJob, reconcileInterruptedExportJobs } from '../src/pipeline/export/exportJob.service.js';
import { previewExport, updateExportJobScope } from '../src/pipeline/export/exportGroups.service.js';
import { executeExportJob } from '../src/pipeline/export/exportJob.runner.js';
import { handleExportRoutes } from '../src/pipeline/export/export.routes.js';

const root = createTrackedTestTempDirectory('media-organizer-export-groups-');
const sourceRoot = path.join(root, 'source');
const destinationPath = path.join(root, 'destination');
const secondDestination = path.join(root, 'second-destination');
const dbPath = path.join(root, 'test.sqlite');
const target = { type: 'network-folder' as const, destinationPath };
const request = { sourceRoot, target };
beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = root;
  process.env.MEDIA_ORGANIZER_DB_PATH = dbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = path.resolve('src/state/migrations');
  resetDbForTests(); fs.rmSync(dbPath, { force: true });
  for (const directory of [sourceRoot, destinationPath, secondDestination]) fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(path.join(sourceRoot, 'A', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'B'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, '.media-organizer', 'trash'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'A', 'a.jpg'), 'photo-a');
  fs.writeFileSync(path.join(sourceRoot, 'A', 'nested', 'notes.txt'), 'notes');
  fs.writeFileSync(path.join(sourceRoot, 'B', 'b.bin'), 'binary');
  fs.writeFileSync(path.join(sourceRoot, 'root.jpg'), 'root');
  fs.writeFileSync(path.join(sourceRoot, '.media-organizer', 'trash', 'hidden.jpg'), 'hidden');
  runMigrations();
});
afterEach(() => { resetDbForTests(); });
after(() => { resetDbForTests(); cleanupTrackedTestTempDirectories(); });

test('network preview is read-only, groups first-level folders and includes all eligible file formats', async () => {
  const preview = await previewExport(request);
  assert.deepEqual(preview.groups.map((group) => group.id).sort(), ['folder:A', 'folder:B', 'root:']);
  assert.equal(preview.groups.find((group) => group.id === 'folder:A')?.itemCount, 2);
  assert.equal(preview.supportedItems, 4);
  assert.equal(preview.unsupportedItems, 0);
  assert.equal(preview.groups.find((group) => group.id === 'root:')?.isRoot, true);
  assert.equal(fs.existsSync(destinationPath), false);
  assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM export_jobs').get() as { n: number }).n, 0);
});

test('selected network groups preserve relative paths and export only selected files', async () => {
  const job = createExportJob({ ...request, target: { ...target, groupIds: ['folder:A'] } });
  assert.equal(job.job.totalItems, 2);
  assert.equal(job.job.eligibleItems, 4);
  await executeExportJob(job.job.id);
  assert.equal(fs.readFileSync(path.join(destinationPath, 'A', 'nested', 'notes.txt'), 'utf8'), 'notes');
  assert.equal(fs.existsSync(path.join(destinationPath, 'B')), false);
  assert.equal(fs.existsSync(path.join(destinationPath, 'root.jpg')), false);
  assert.deepEqual(getExportProgress(job.job.id)?.groupProgress?.map((group) => [group.groupId, group.status]), [['folder:A', 'completed']]);
});

test('explicit empty or unknown scopes are rejected while legacy jobs still export everything', () => {
  assert.throws(() => createExportJob({ ...request, target: { ...target, groupIds: [] } }), /at least one/);
  assert.throws(() => createExportJob({ ...request, target: { ...target, groupIds: ['folder:../escape'] } }), /Unknown/);
  assert.throws(() => createExportJob({ ...request, target: { ...target, groupIds: [42 as unknown as string] } }), /array/);
  assert.equal(createExportJob(request).job.totalItems, 4);
});

test('follow-up jobs plan only pending files, retain old jobs and stay isolated by destination', async () => {
  const first = createExportJob({ ...request, target: { ...target, groupIds: ['folder:A'] } });
  await executeExportJob(first.job.id);
  const preview = await previewExport(request);
  assert.equal(preview.groups.find((group) => group.id === 'folder:A')?.exportStatus, 'completed');
  const second = createExportJob(request);
  assert.equal(second.job.totalItems, 2);
  await executeExportJob(second.job.id);
  assert.equal(getExportJob(first.job.id)?.job.status, 'completed');
  assert.equal((await previewExport(request)).groups.every((group) => group.exportStatus === 'completed'), true);
  const other = createExportJob({ ...request, target: { ...target, destinationPath: secondDestination } });
  assert.equal(other.job.totalItems, 4);
});

test('modified sources, removed outputs and changed destination contents become pending again', async () => {
  const first = createExportJob(request);
  await executeExportJob(first.job.id);
  fs.writeFileSync(path.join(sourceRoot, 'A', 'a.jpg'), 'changed');
  fs.rmSync(path.join(destinationPath, 'B', 'b.bin'));
  fs.writeFileSync(path.join(destinationPath, 'root.jpg'), 'lost');
  fs.writeFileSync(path.join(sourceRoot, 'A', 'new.jpg'), 'new');
  const second = createExportJob(request);
  assert.equal(second.job.totalItems, 4);
  await executeExportJob(second.job.id);
  assert.equal(fs.readFileSync(path.join(destinationPath, 'A', 'a.jpg'), 'utf8'), 'changed');
  assert.equal(fs.readFileSync(path.join(destinationPath, 'root.jpg'), 'utf8'), 'root');
});

test('paused scopes change untouched groups while protecting processed and previously attempted groups', () => {
  const first = createExportJob(request);
  const db = getDb();
  db.prepare("UPDATE export_items SET status = 'completed' WHERE job_id = ? AND relative_path = ?")
    .run(first.job.id, path.join('A', 'a.jpg'));
  db.prepare("UPDATE export_items SET attempt_count = 1 WHERE job_id = ? AND relative_path = ?")
    .run(first.job.id, path.join('B', 'b.bin'));
  pauseExportJob(first.job.id);
  const updated = updateExportJobScope(first.job.id, []);
  assert.deepEqual(JSON.parse(updated!.checkpoint!.payloadJson!).target.groupIds.sort(), ['folder:A', 'folder:B']);
  assert.equal(updated?.job.totalItems, 3);
  assert.equal(updated?.job.eligibleItems, 4);
  const expanded = updateExportJobScope(first.job.id, ['root:']);
  assert.equal(expanded?.job.totalItems, 4);
  assert.equal(expanded?.job.completedItems, 1);
});

test('an empty paused scope stays paused and can later select root files without starting automatically', () => {
  const first = createExportJob(request);
  pauseExportJob(first.job.id);
  const empty = updateExportJobScope(first.job.id, []);
  assert.equal(empty?.job.totalItems, 0);
  assert.equal(empty?.job.status, 'paused');
  assert.throws(() => assertExportJobCanStart(first.job.id), /at least one export group/);
  const restored = updateExportJobScope(first.job.id, ['root:']);
  assert.equal(restored?.job.totalItems, 1);
  assert.equal(restored?.job.status, 'paused');
  assert.equal(fs.existsSync(destinationPath), false);
});

test('network scope waits until a paused runner has fully stopped', async () => {
  const first = createExportJob(request);
  const execution = executeExportJob(first.job.id);
  pauseExportJob(first.job.id);
  try { assert.throws(() => updateExportJobScope(first.job.id, ['root:']), /finishing its current file/); }
  finally { await execution; }
  assert.equal(updateExportJobScope(first.job.id, ['root:'])?.job.totalItems, 1);
  assert.equal(fs.existsSync(destinationPath), false);
});

test('group identifiers respect native separators and distinguish root files from literal backslashes on Unix', async () => {
  const { getNetworkExportGroupId } = await import('../src/pipeline/export/exportGroupIds.js');
  assert.equal(getNetworkExportGroupId('A/nested/file.jpg', '/'), 'folder:A');
  assert.equal(getNetworkExportGroupId('A\\nested\\file.jpg', '\\'), 'folder:A');
  assert.equal(getNetworkExportGroupId('root\\file.jpg', '/'), 'root:');
});

test('scope updates reject running and terminal jobs without changing checkpoints or item rows', () => {
  const first = createExportJob(request);
  for (const status of ['running', 'completed', 'failed', 'cancelled']) {
    getDb().prepare('UPDATE export_jobs SET status = ? WHERE id = ?').run(status, first.job.id);
    assert.throws(() => updateExportJobScope(first.job.id, ['root:']), /paused or draft/);
    assert.equal(getExportJob(first.job.id)?.job.totalItems, 4);
    assert.equal(getExportJob(first.job.id)?.checkpoint?.payloadJson, first.checkpoint?.payloadJson);
  }
});

test('restored preview includes every persisted item beyond the 50-item recent window', async () => {
  for (let i = 0; i < 70; i++) fs.writeFileSync(path.join(sourceRoot, 'B', `${i}.jpg`), `${i}`);
  const first = createExportJob(request);
  await executeExportJob(first.job.id);
  assert.equal(getExportProgress(first.job.id)?.recentItems.length, 50);
  const preview = await previewExport({ ...request, jobId: first.job.id });
  assert.equal(preview.groups.flatMap((group) => group.items).length, 74);
  assert.equal(preview.groups.every((group) => group.exportStatus === 'completed'), true);
});

test('interruption restores selected scope and replaces incomplete copies on explicit resume', async () => {
  const first = createExportJob({ ...request, target: { ...target, groupIds: ['folder:A'] } });
  getDb().prepare("UPDATE export_jobs SET status = 'running' WHERE id = ?").run(first.job.id);
  getDb().prepare("UPDATE export_items SET status = 'running', attempt_count = 1 WHERE job_id = ?").run(first.job.id);
  fs.mkdirSync(path.join(destinationPath, 'A'), { recursive: true });
  fs.writeFileSync(path.join(destinationPath, 'A', 'a.jpg'), 'partial');
  reconcileInterruptedExportJobs();
  assert.deepEqual(JSON.parse(getExportJob(first.job.id)!.checkpoint!.payloadJson!).target.groupIds, ['folder:A']);
  await previewExport({ ...request, jobId: first.job.id });
  assert.equal(getExportJob(first.job.id)?.job.status, 'paused');
  await executeExportJob(first.job.id);
  assert.equal(fs.existsSync(path.join(destinationPath, 'B')), false);
  assert.equal(fs.readFileSync(path.join(destinationPath, 'A', 'a.jpg'), 'utf8'), 'photo-a');
});

test('preview refuses job state from another destination or source', async () => {
  const first = createExportJob(request);
  await assert.rejects(previewExport({ ...request, target: { ...target, destinationPath: secondDestination }, jobId: first.job.id }), /context/);
  await assert.rejects(previewExport({ ...request, sourceRoot: path.join(sourceRoot, 'A'), jobId: first.job.id }), /context/);
});

test('historical job previews retain their original files even after the source is removed', async () => {
  const first = createExportJob({ ...request, target: { ...target, groupIds: ['folder:A'] } });
  await executeExportJob(first.job.id);
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  const preview = await previewExport({ ...request, jobId: first.job.id, jobOnly: true });
  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].itemCount, 2);
  assert.equal(preview.groups[0].exportStatus, 'completed');
});

test('zero-pending plans are terminal and do not block later exports to the same destination', async () => {
  const first = createExportJob(request);
  await executeExportJob(first.job.id);
  const empty = createExportJob(request);
  assert.equal(empty.job.totalItems, 0);
  assert.equal(empty.job.status, 'completed');
  fs.writeFileSync(path.join(sourceRoot, 'B', 'new.bin'), 'new');
  assert.equal(createExportJob(request).job.totalItems, 1);
});

test('partial network jobs keep global provider coverage partial until the remaining files are exported', async () => {
  const { upsertExecutionHistory, linkGroupingExecution } = await import('../src/dashboard/dashboard.service.js');
  const { listExportProviderSummaries } = await import('../src/pipeline/export/exportSummary.service.js');
  upsertExecutionHistory({ sessionId: 'compression-coverage', name: null, sourceDir: sourceRoot, outputDir: destinationPath,
    outputRoot: sourceRoot, status: 'completed', startedAt: '2026-01-01T10:00:00Z', finishedAt: '2026-01-01T11:00:00Z',
    updatedAt: '2026-01-01T11:00:00Z', totalItems: 4, imageItems: 4, videoItems: 0, completedItems: 4,
    failedItems: 0, imageProfileLabel: null, videoPresetLabel: null, errorSummary: [] });
  linkGroupingExecution('compression-coverage', 'grouping-coverage');
  const scopedRequest = { ...request, groupingSessionId: 'grouping-coverage' };
  const first = createExportJob({ ...scopedRequest, target: { ...target, groupIds: ['folder:A'] } });
  await executeExportJob(first.job.id);
  const partial = listExportProviderSummaries(scopedRequest).find((summary) => summary.provider === 'network-folder')!;
  assert.equal(partial.coverageStatus, 'partial'); assert.equal(partial.eligibleItems, 4); assert.equal(partial.coveredItems, 2);
  const second = createExportJob(scopedRequest);
  await executeExportJob(second.job.id);
  const full = listExportProviderSummaries(scopedRequest).find((summary) => summary.provider === 'network-folder')!;
  assert.equal(full.coverageStatus, 'completed'); assert.equal(full.coveredItems, 4); assert.equal(full.completedJobs, 2);
});

test('generic preview and scope routes validate input and preserve the selected checkpoint', async () => {
  const server = createServer((req, res) => {
    if (!handleExportRoutes({ req, res, requestUrl: new URL(req.url!, 'http://localhost') })) {
      res.writeHead(404); res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const send = (route: string, body: unknown, method = 'POST') => fetch(url + route, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  try {
    assert.equal((await send('/api/export/preview', {})).status, 400);
    const preview = await send('/api/export/preview', request);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).groups.length, 3);
    const first = createExportJob(request);
    assert.equal((await send(`/api/export/jobs/${first.job.id}/scope`, { groupIds: [7] }, 'PATCH')).status, 400);
    const scoped = await send(`/api/export/jobs/${first.job.id}/scope`, { groupIds: ['root:'] }, 'PATCH');
    assert.equal(scoped.status, 200);
    assert.equal((await scoped.json()).job.totalItems, 1);
    const progress = await fetch(`${url}/api/export/jobs/${first.job.id}/progress`);
    assert.equal((await progress.json()).runnerActive, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
