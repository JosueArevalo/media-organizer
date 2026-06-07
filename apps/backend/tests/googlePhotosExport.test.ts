import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { getDb, resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-google-photos-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');
const sourceRoot = path.join(tempRoot, 'source');

const originalFetch = globalThis.fetch;

const resetFolders = () => {
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(sourceRoot, '2026.04 - Trip'), { recursive: true });
};

const insertGooglePhotosAccount = async (accountId = 'account-1', email = 'user@example.com') => {
  const { runMigrations } = await import('../src/state/migrations/runMigrations.js?google-photos-test=1');
  runMigrations();
  getDb()
    .prepare(
      `
        INSERT INTO google_photos_accounts (
          id, email, display_name, access_token, refresh_token, expires_at, scope, created_at, updated_at, last_connected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      accountId,
      email,
      'Example User',
      'access-token',
      'refresh-token',
      '2099-01-01T00:00:00.000Z',
      null,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    );
};

beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  process.env.GOOGLE_PHOTOS_CLIENT_ID = 'client-id';
  process.env.GOOGLE_PHOTOS_CLIENT_SECRET = '';
  process.env.GOOGLE_PHOTOS_REDIRECT_URI = 'http://localhost:4000/api/export/google-photos/oauth/callback';
  fs.rmSync(tempDbPath, { force: true });
  resetDbForTests();
  resetFolders();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetDbForTests();
  delete process.env.GOOGLE_PHOTOS_CLIENT_ID;
  delete process.env.GOOGLE_PHOTOS_CLIENT_SECRET;
  delete process.env.GOOGLE_PHOTOS_REDIRECT_URI;
});

test('Google Photos OAuth stores connected account without raw Google credentials', async () => {
  const { startGooglePhotosOAuth, completeGooglePhotosOAuth, listGooglePhotosAccounts } = await import(
    '../src/pipeline/export/googlePhotosAuth.service.js?oauth=1'
  );

  const start = startGooglePhotosOAuth();
  assert.match(start.authUrl, /accounts\.google\.com/);
  assert.match(start.authUrl, /code_challenge=/);

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        scope: 'scope'
      }), { status: 200 });
    }

    if (url.includes('openidconnect.googleapis.com')) {
      return new Response(JSON.stringify({ email: 'user@example.com', name: 'Example User' }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const account = await completeGooglePhotosOAuth('authorization-code', start.state);
  assert.equal(account.email, 'user@example.com');
  assert.equal(listGooglePhotosAccounts().length, 1);

  const stored = getDb().prepare('SELECT access_token, refresh_token FROM google_photos_accounts WHERE id = ?').get(account.id) as {
    access_token: string;
    refresh_token: string;
  };
  assert.equal(stored.access_token, 'new-access-token');
  assert.equal(stored.refresh_token, 'new-refresh-token');
});

test('Google Photos OAuth config reports missing setup and blocks OAuth start', async () => {
  delete process.env.GOOGLE_PHOTOS_CLIENT_ID;
  delete process.env.GOOGLE_PHOTOS_CLIENT_SECRET;
  const { getGooglePhotosOAuthConfigStatus, startGooglePhotosOAuth } = await import(
    '../src/pipeline/export/googlePhotosAuth.service.js?missing-config=1'
  );

  const status = getGooglePhotosOAuthConfigStatus();
  assert.equal(status.configured, false);
  assert.equal(status.source, 'none');
  assert.match(status.redirectUri, /\/api\/export\/google-photos\/oauth\/callback$/);
  assert.throws(() => startGooglePhotosOAuth(), /OAuth is not configured/);
});

test('Google Photos OAuth config saves local setup and prefers it over env', async () => {
  process.env.GOOGLE_PHOTOS_CLIENT_ID = 'env-client-id';
  const { getGooglePhotosOAuthConfigStatus, saveGooglePhotosOAuthConfig, startGooglePhotosOAuth } = await import(
    '../src/pipeline/export/googlePhotosAuth.service.js?local-config=1'
  );

  const saved = saveGooglePhotosOAuthConfig({
    clientId: 'local-client-id',
    clientSecret: 'local-client-secret'
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.source, 'local-db');
  assert.equal(saved.hasClientSecret, true);

  const status = getGooglePhotosOAuthConfigStatus();
  assert.equal(status.source, 'local-db');

  const start = startGooglePhotosOAuth();
  const authUrl = new URL(start.authUrl);
  assert.equal(authUrl.searchParams.get('client_id'), 'local-client-id');
});

test('Google Photos OAuth config falls back to env when local setup is absent', async () => {
  process.env.GOOGLE_PHOTOS_CLIENT_ID = 'env-client-id';
  process.env.GOOGLE_PHOTOS_CLIENT_SECRET = 'env-client-secret';
  const { getGooglePhotosOAuthConfigStatus, startGooglePhotosOAuth } = await import(
    '../src/pipeline/export/googlePhotosAuth.service.js?env-config=1'
  );

  const status = getGooglePhotosOAuthConfigStatus();
  assert.equal(status.configured, true);
  assert.equal(status.source, 'env');
  assert.equal(status.hasClientSecret, true);

  const authUrl = new URL(startGooglePhotosOAuth().authUrl);
  assert.equal(authUrl.searchParams.get('client_id'), 'env-client-id');
});

test('Google Photos export creates media items one by one with file names and MIME headers', async () => {
  await insertGooglePhotosAccount();

  for (let index = 0; index < 51; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', `photo-${index}.jpg`), `image-${index}`);
  }

  const batchSizes: number[] = [];
  const uploadContentTypes: string[] = [];
  const batchFileNames: string[] = [];
  const batchDescriptions: Array<string | undefined> = [];
  let uploadCount = 0;
  let albumCreateCount = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      albumCreateCount += 1;
      return new Response(JSON.stringify({ id: 'album-1', title: '2026.04 - Trip' }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      uploadCount += 1;
      const headers = new Headers(init?.headers);
      uploadContentTypes.push(headers.get('X-Goog-Upload-Content-Type') ?? '');
      return new Response(`upload-token-${uploadCount}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      const body = JSON.parse(String(init?.body)) as {
        newMediaItems: Array<{
          description?: string;
          simpleMediaItem: { uploadToken: string; fileName?: string };
        }>;
      };
      batchSizes.push(body.newMediaItems.length);
      for (const item of body.newMediaItems) {
        batchFileNames.push(item.simpleMediaItem.fileName ?? '');
        batchDescriptions.push(item.description);
      }
      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item, index) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: `media-${batchSizes.length}-${index}` }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-run=1');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-run=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });

  await executeExportJob(job.job.id);

  const progress = getExportProgress(job.job.id);
  assert.equal(progress?.status, 'completed');
  assert.equal(progress?.completed, 51);
  assert.equal(progress?.failed, 0);
  assert.equal(albumCreateCount, 1);
  assert.deepEqual(batchSizes, Array.from({ length: 51 }, () => 1));
  assert.equal(uploadContentTypes.every((contentType) => contentType === 'image/jpeg'), true);
  assert.equal(batchFileNames.includes('photo-0.jpg'), true);
  assert.equal(batchFileNames.includes('photo-50.jpg'), true);
  assert.equal(batchDescriptions.every((description) => description === undefined), true);
});

test('Google Photos export job can be filtered to one album', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.mkdirSync(path.join(sourceRoot, 'Family Photos'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'Family Photos', 'photo-b.jpg'), 'image-b');

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-album-filter=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['Family Photos'] }
  });

  const progress = getExportProgress(job.job.id);
  assert.equal(job.job.eligibleItems, 1);
  assert.equal(job.job.eligibleAlbums, 1);
  assert.equal(progress?.total, 1);
  assert.equal(progress?.albumProgress?.length, 1);
  assert.equal(progress?.albumProgress?.[0]?.albumTitle, 'Family Photos');
});

test('Google Photos export job eligibility follows the selected album set', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.mkdirSync(path.join(sourceRoot, 'Family Photos'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'Family Photos', 'photo-b.jpg'), 'image-b');
  fs.mkdirSync(path.join(sourceRoot, 'Private Album'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'Private Album', 'photo-c.jpg'), 'image-c');

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-album-set-filter=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['2026.04 - Trip', 'Family Photos'] }
  });

  const progress = getExportProgress(job.job.id);
  assert.equal(job.job.eligibleItems, 2);
  assert.equal(job.job.eligibleAlbums, 2);
  assert.equal(progress?.total, 2);
  assert.deepEqual(progress?.albumProgress?.map((album) => album.albumTitle), ['2026.04 - Trip', 'Family Photos']);
});

test('Google Photos paused export scope can change only unprocessed albums', async () => {
  await insertGooglePhotosAccount();
  fs.mkdirSync(path.join(sourceRoot, 'Album A'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'Album B'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'Album C'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'Album D'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'Album A', 'done.jpg'), 'done');
  fs.writeFileSync(path.join(sourceRoot, 'Album A', 'pending.jpg'), 'pending');
  fs.writeFileSync(path.join(sourceRoot, 'Album B', 'b.jpg'), 'b');
  fs.writeFileSync(path.join(sourceRoot, 'Album C', 'c.jpg'), 'c');
  fs.writeFileSync(path.join(sourceRoot, 'Album D', 'd.jpg'), 'd');

  const uploadedFileNames: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { album: { title: string } };
      return new Response(JSON.stringify({ id: `album-${body.album.title}`, title: body.album.title }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      uploadedFileNames.push(String((init?.headers as Record<string, string>)['X-Goog-Upload-File-Name'] ?? ''));
      return new Response(`upload-token-${uploadedFileNames.length}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      const body = JSON.parse(String(init?.body)) as {
        newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }>;
      };
      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item, index) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: `media-${index}-${item.simpleMediaItem.uploadToken}` }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const {
    createExportJob,
    getExportProgress,
    pauseExportJob,
    updateGooglePhotosExportJobScope
  } = await import('../src/pipeline/export/exportJob.service.js?google-paused-scope=1');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-paused-scope=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['Album A', 'Album B', 'Album C'] }
  });

  const completedRow = getDb()
    .prepare("SELECT id FROM export_items WHERE job_id = ? AND destination_path = 'Album A' AND relative_path LIKE '%done.jpg'")
    .get(job.job.id) as { id: string };
  getDb().prepare("UPDATE export_items SET status = 'completed' WHERE id = ?").run(completedRow.id);
  pauseExportJob(job.job.id);

  const withoutAlbumBJob = updateGooglePhotosExportJobScope(job.job.id, ['Album A', 'Album C']);
  assert.ok(withoutAlbumBJob);
  assert.equal(withoutAlbumBJob.job.eligibleItems, 3);
  assert.equal(withoutAlbumBJob.job.eligibleAlbums, 2);

  const withoutAlbumBCheckpoint = JSON.parse(withoutAlbumBJob.checkpoint?.payloadJson ?? '{}') as {
    target?: { albumTitles?: string[] };
  };
  assert.deepEqual(withoutAlbumBCheckpoint.target?.albumTitles, ['Album A', 'Album C']);

  const withoutAlbumBProgress = getExportProgress(job.job.id);
  assert.equal(withoutAlbumBProgress?.total, 3);
  assert.deepEqual(
    withoutAlbumBProgress?.albumProgress?.map((album) => ({
      title: album.albumTitle,
      total: album.total,
      completed: album.completed,
      pending: album.pending
    })),
    [
      { title: 'Album A', total: 2, completed: 1, pending: 1 },
      { title: 'Album C', total: 1, completed: 0, pending: 1 }
    ]
  );

  const scopedJob = updateGooglePhotosExportJobScope(job.job.id, ['Album A', 'Album C', 'Album D']);
  assert.ok(scopedJob);
  assert.equal(scopedJob.job.eligibleItems, 4);
  assert.equal(scopedJob.job.eligibleAlbums, 3);

  const checkpoint = JSON.parse(scopedJob.checkpoint?.payloadJson ?? '{}') as {
    target?: { albumTitles?: string[] };
  };
  assert.deepEqual(checkpoint.target?.albumTitles, ['Album A', 'Album C', 'Album D']);

  const scopedProgress = getExportProgress(job.job.id);
  assert.equal(scopedProgress?.total, 4);
  assert.deepEqual(
    scopedProgress?.albumProgress?.map((album) => ({
      title: album.albumTitle,
      total: album.total,
      completed: album.completed,
      pending: album.pending
    })),
    [
      { title: 'Album A', total: 2, completed: 1, pending: 1 },
      { title: 'Album C', total: 1, completed: 0, pending: 1 },
      { title: 'Album D', total: 1, completed: 0, pending: 1 }
    ]
  );

  await executeExportJob(job.job.id);

  assert.deepEqual(uploadedFileNames.sort(), ['c.jpg', 'd.jpg', 'pending.jpg']);
  assert.equal(getExportProgress(job.job.id)?.status, 'completed');
});

test('Google Photos album scope cannot change while running or completed', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');

  const {
    createExportJob,
    updateExportJobStatus,
    updateGooglePhotosExportJobScope
  } = await import('../src/pipeline/export/exportJob.service.js?google-scope-status=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['2026.04 - Trip'] }
  });

  updateExportJobStatus(job.job.id, 'running');
  assert.throws(
    () => updateGooglePhotosExportJobScope(job.job.id, ['2026.04 - Trip']),
    /can only be changed while the export is paused/
  );

  updateExportJobStatus(job.job.id, 'completed');
  assert.throws(
    () => updateGooglePhotosExportJobScope(job.job.id, ['2026.04 - Trip']),
    /can only be changed while the export is paused/
  );
});

test('Google Photos paused export can keep an empty editable album scope', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');

  const {
    createExportJob,
    getExportProgress,
    pauseExportJob,
    updateGooglePhotosExportJobScope
  } = await import('../src/pipeline/export/exportJob.service.js?google-empty-scope=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['2026.04 - Trip'] }
  });

  pauseExportJob(job.job.id);
  const emptyScopeJob = updateGooglePhotosExportJobScope(job.job.id, []);
  assert.equal(emptyScopeJob?.job.status, 'paused');
  assert.equal(emptyScopeJob?.job.totalItems, 0);
  assert.equal(getExportProgress(job.job.id)?.status, 'paused');
  assert.deepEqual(
    JSON.parse(emptyScopeJob?.checkpoint?.payloadJson ?? '{}').target.albumTitles,
    []
  );
});

test('Google Photos full export plans only albums still pending after a completed album job', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.mkdirSync(path.join(sourceRoot, 'Family Photos'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'Family Photos', 'photo-b.jpg'), 'image-b');

  let uploadCount = 0;
  let batchFileNames: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { album: { title: string } };
      return new Response(JSON.stringify({ id: `album-${body.album.title}`, title: body.album.title }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      uploadCount += 1;
      return new Response(`upload-token-${uploadCount}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      const body = JSON.parse(String(init?.body)) as {
        newMediaItems: Array<{ simpleMediaItem: { uploadToken: string; fileName?: string } }>;
      };
      batchFileNames.push(...body.newMediaItems.map((item) => item.simpleMediaItem.fileName ?? ''));
      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item, index) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: `media-${uploadCount}-${index}` }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob, getExportProgress, previewGooglePhotosExport } = await import(
    '../src/pipeline/export/exportJob.service.js?google-pending-albums=1'
  );
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-pending-albums=1');
  const firstAlbumJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['2026.04 - Trip'] }
  });

  await executeExportJob(firstAlbumJob.job.id);

  const preview = await previewGooglePhotosExport('account-1', sourceRoot);
  assert.deepEqual(
    preview.albums.map((album) => ({ title: album.albumTitle, uploadStatus: album.uploadStatus })),
    [
      { title: '2026.04 - Trip', uploadStatus: 'completed' },
      { title: 'Family Photos', uploadStatus: 'pending' }
    ]
  );

  batchFileNames = [];
  const fullJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });
  const plannedProgress = getExportProgress(fullJob.job.id);
  assert.equal(fullJob.job.eligibleItems, 2);
  assert.equal(fullJob.job.eligibleAlbums, 2);
  assert.equal(plannedProgress?.total, 1);
  assert.deepEqual(plannedProgress?.albumProgress?.map((album) => album.albumTitle), ['Family Photos']);

  await executeExportJob(fullJob.job.id);

  assert.deepEqual(batchFileNames, ['photo-b.jpg']);
  assert.equal(getExportProgress(fullJob.job.id)?.completed, 1);

  const noPendingJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });
  const noPendingProgress = getExportProgress(noPendingJob.job.id);
  assert.equal(noPendingJob.job.totalItems, 0);
  assert.equal(noPendingProgress?.total, 0);
  assert.deepEqual(noPendingProgress?.albumProgress, []);
});

test('Google Photos pending planning is scoped to the connected account', async () => {
  await insertGooglePhotosAccount('account-1', 'user-one@example.com');
  await insertGooglePhotosAccount('account-2', 'user-two@example.com');
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'album-1', title: '2026.04 - Trip' }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      return new Response('upload-token', { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };
      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: 'media-1' }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-account-scope=1');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-account-scope=1');
  const firstAccountJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });
  await executeExportJob(firstAccountJob.job.id);

  const sameAccountJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });
  const otherAccountJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-2' }
  });

  assert.equal(getExportProgress(sameAccountJob.job.id)?.total, 0);
  assert.equal(getExportProgress(otherAccountJob.job.id)?.total, 1);
});

test('Google Photos pending planning includes new files added to a completed album', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'album-1', title: '2026.04 - Trip' }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      return new Response('upload-token', { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };
      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: 'media-1' }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-new-file=1');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-new-file=1');
  const firstJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });
  await executeExportJob(firstJob.job.id);

  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-new.jpg'), 'image-new');

  const nextJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });
  const progress = getExportProgress(nextJob.job.id);

  assert.equal(nextJob.job.eligibleItems, 2);
  assert.equal(nextJob.job.eligibleAlbums, 1);
  assert.equal(progress?.total, 1);
  assert.equal(progress?.recentItems[0]?.relativePath, path.join('2026.04 - Trip', 'photo-new.jpg'));
});

test('Google Photos preview returns supported items per album', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'notes.txt'), 'not-media');

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { previewGooglePhotosExport } = await import('../src/pipeline/export/exportJob.service.js?google-preview-items=1');
  const preview = await previewGooglePhotosExport('account-1', sourceRoot);

  assert.equal(preview.supportedItems, 1);
  assert.equal(preview.unsupportedItems, 1);
  assert.deepEqual(preview.albums[0]?.items, [
    {
      relativePath: path.join('2026.04 - Trip', 'photo-a.jpg'),
      sizeBytes: 7,
      supported: true
    }
  ]);
  assert.equal(preview.albums[0]?.uploadStatus, 'pending');
});

test('Google Photos export progress groups items by album', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.mkdirSync(path.join(sourceRoot, 'Family Photos'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'Family Photos', 'photo-b.jpg'), 'image-b');

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-album-progress=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });

  const progress = getExportProgress(job.job.id);
  assert.equal(progress?.total, 2);
  assert.deepEqual(
    progress?.albumProgress?.map((album) => ({
      albumTitle: album.albumTitle,
      total: album.total,
      pending: album.pending,
      status: album.status
    })),
    [
      { albumTitle: '2026.04 - Trip', total: 1, pending: 1, status: 'pending' },
      { albumTitle: 'Family Photos', total: 1, pending: 1, status: 'pending' }
    ]
  );
});

test('Google Photos export persists partial failures and does not retry completed media items', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-b.jpg'), 'image-b');

  let batchAttempt = 0;
  let uploadCount = 0;
  const logs: string[] = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;

  console.info = (...values: unknown[]) => {
    logs.push(values.join(' '));
  };
  console.warn = (...values: unknown[]) => {
    logs.push(values.join(' '));
  };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'album-1', title: '2026.04 - Trip' }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      uploadCount += 1;
      return new Response(`upload-token-sensitive-${uploadCount}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      batchAttempt += 1;
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };
      const results = body.newMediaItems.map((item, index) => {
        if (item.simpleMediaItem.uploadToken === 'upload-token-sensitive-2' && batchAttempt === 2) {
          return {
            uploadToken: item.simpleMediaItem.uploadToken,
            status: {
              code: 3,
              message: 'NOT_IMAGE: There was an error while trying to create this media item.',
              details: [{ reason: 'IMAGE_PROCESSING_FAILED' }]
            }
          };
        }

        return {
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: `media-${batchAttempt}-${index}` }
        };
      });

      return new Response(JSON.stringify({ newMediaItemResults: results }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob, getExportProgress, retryFailedExportItems } = await import(
    '../src/pipeline/export/exportJob.service.js?google-partial=1'
  );
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-partial=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });

  try {
    await executeExportJob(job.job.id);
    const failedProgress = getExportProgress(job.job.id);
    assert.equal(failedProgress?.status, 'failed');
    assert.equal(failedProgress?.completed, 1);
    assert.equal(failedProgress?.failed, 1);

    const failedItem = failedProgress?.recentItems.find((item) => item.status === 'failed');
    assert.match(failedItem?.lastError ?? '', /Google Photos rejected media item/);
    assert.match(failedItem?.lastError ?? '', /Code: 3/);
    assert.match(failedItem?.lastError ?? '', /NOT_IMAGE/);
    assert.match(failedItem?.lastError ?? '', /IMAGE_PROCESSING_FAILED/);
    assert.match(failedItem?.lastError ?? '', /Upload token: upload\.\.\.tive-2/);
    assert.doesNotMatch(failedItem?.lastError ?? '', /upload-token-sensitive-2/);

    assert.ok(logs.some((entry) => entry.includes('[google-photos]')));
    assert.ok(logs.some((entry) => entry.includes('Google Photos rejected media item')));
    assert.equal(logs.some((entry) => entry.includes('upload-token-sensitive-2')), false);

    retryFailedExportItems(job.job.id);
    await executeExportJob(job.job.id);
    const finalProgress = getExportProgress(job.job.id);
    assert.equal(finalProgress?.status, 'completed');
    assert.equal(finalProgress?.completed, 2);
    assert.equal(finalProgress?.failed, 0);

    const createdRows = getDb()
      .prepare("SELECT media_item_id FROM export_google_photos_items WHERE phase = 'created'")
      .all() as Array<{ media_item_id: string | null }>;
    assert.equal(createdRows.length, 2);
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }
});

test('Google Photos pause during media creation stops before the next item and resumes remaining work', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-b.jpg'), 'image-b');
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-c.jpg'), 'image-c');

  let batchCount = 0;
  let releaseFirstBatch: (() => void) | null = null;
  let notifyFirstBatch: (() => void) | null = null;
  const firstBatchStarted = new Promise<void>((resolve) => {
    notifyFirstBatch = resolve;
  });
  const firstBatchReleased = new Promise<void>((resolve) => {
    releaseFirstBatch = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'album-1', title: '2026.04 - Trip' }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      return new Response(`upload-token-${batchCount + 1}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      batchCount += 1;
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };

      if (batchCount === 1) {
        notifyFirstBatch?.();
        await firstBatchReleased;
      }

      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: `media-${batchCount}` }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob, getExportProgress, pauseExportJob } = await import(
    '../src/pipeline/export/exportJob.service.js?google-pause-race=1'
  );
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-pause-race=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });

  const execution = executeExportJob(job.job.id);
  await firstBatchStarted;
  pauseExportJob(job.job.id);
  releaseFirstBatch?.();
  await execution;

  const pausedProgress = getExportProgress(job.job.id);
  assert.equal(pausedProgress?.status, 'paused');
  assert.equal(pausedProgress?.completed, 1);
  assert.equal(pausedProgress?.pending, 2);
  assert.equal(batchCount, 1);

  await executeExportJob(job.job.id);

  const completedProgress = getExportProgress(job.job.id);
  assert.equal(completedProgress?.status, 'completed');
  assert.equal(completedProgress?.completed, 3);
  assert.equal(completedProgress?.pending, 0);
  assert.equal(batchCount, 3);
});

test('Google Photos duplicate runner calls for the same job do not start a second upload loop', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');

  let uploadCount = 0;
  let batchCount = 0;
  let releaseBatch: (() => void) | null = null;
  let notifyBatchStarted: (() => void) | null = null;
  const batchStarted = new Promise<void>((resolve) => {
    notifyBatchStarted = resolve;
  });
  const batchReleased = new Promise<void>((resolve) => {
    releaseBatch = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'album-1', title: '2026.04 - Trip' }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      uploadCount += 1;
      return new Response(`upload-token-${uploadCount}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      batchCount += 1;
      notifyBatchStarted?.();
      await batchReleased;
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };
      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: `media-${batchCount}` }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-duplicate-runner=1');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-duplicate-runner=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });

  const firstExecution = executeExportJob(job.job.id);
  await batchStarted;
  const duplicateExecution = await executeExportJob(job.job.id);
  releaseBatch?.();
  await firstExecution;

  assert.equal(duplicateExecution?.job.id, job.job.id);
  assert.equal(uploadCount, 1);
  assert.equal(batchCount, 1);
  assert.equal(getExportProgress(job.job.id)?.completed, 1);
});

test('Google Photos rejects starting a different job while another export is active', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.mkdirSync(path.join(sourceRoot, 'Family Photos'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'Family Photos', 'photo-b.jpg'), 'image-b');

  let releaseBatch: (() => void) | null = null;
  let notifyBatchStarted: (() => void) | null = null;
  const batchStarted = new Promise<void>((resolve) => {
    notifyBatchStarted = resolve;
  });
  const batchReleased = new Promise<void>((resolve) => {
    releaseBatch = resolve;
  });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { album: { title: string } };
      return new Response(JSON.stringify({ id: `album-${body.album.title}`, title: body.album.title }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      return new Response('upload-token', { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      notifyBatchStarted?.();
      await batchReleased;
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };
      return new Response(JSON.stringify({
        newMediaItemResults: body.newMediaItems.map((item) => ({
          uploadToken: item.simpleMediaItem.uploadToken,
          mediaItem: { id: 'media-1' }
        }))
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  const { createExportJob } = await import('../src/pipeline/export/exportJob.service.js?google-other-active=1');
  const { executeExportJob } = await import('../src/pipeline/export/exportJob.runner.js?google-other-active=1');
  const firstJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['2026.04 - Trip'] }
  });
  const secondJob = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1', albumTitles: ['Family Photos'] }
  });

  const firstExecution = executeExportJob(firstJob.job.id);
  await batchStarted;
  await assert.rejects(() => executeExportJob(secondJob.job.id), /Another Google Photos export is already running/);
  releaseBatch?.();
  await firstExecution;
});

test('Google Photos planning skips unsupported file types before upload', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'notes.txt'), 'not media');

  const { createExportJob, getExportProgress } = await import('../src/pipeline/export/exportJob.service.js?google-skip=1');
  const job = createExportJob({
    sourceRoot,
    target: { type: 'google-photos', accountId: 'account-1' }
  });

  const progress = getExportProgress(job.job.id);
  assert.equal(progress?.total, 1);
  assert.equal(job.job.eligibleItems, 0);
  assert.equal(job.job.eligibleAlbums, 0);
  assert.equal(progress?.recentItems[0].status, 'skipped');
  assert.match(progress?.recentItems[0].lastError ?? '', /not supported/);
});
