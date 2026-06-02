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

const insertGooglePhotosAccount = async (accountId = 'account-1') => {
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
      'user@example.com',
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

test('Google Photos export creates one album per folder and batches media item creation', async () => {
  await insertGooglePhotosAccount();

  for (let index = 0; index < 51; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', `photo-${index}.jpg`), `image-${index}`);
  }

  const batchSizes: number[] = [];
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
      return new Response(`upload-token-${uploadCount}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };
      batchSizes.push(body.newMediaItems.length);
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
  assert.deepEqual(batchSizes, [50, 1]);
});

test('Google Photos export persists partial failures and does not retry completed media items', async () => {
  await insertGooglePhotosAccount();
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-a.jpg'), 'image-a');
  fs.writeFileSync(path.join(sourceRoot, '2026.04 - Trip', 'photo-b.jpg'), 'image-b');

  let batchAttempt = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/albums') && init?.method !== 'POST') {
      return new Response(JSON.stringify({ albums: [] }), { status: 200 });
    }

    if (url.endsWith('/albums') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'album-1', title: '2026.04 - Trip' }), { status: 200 });
    }

    if (url.endsWith('/uploads')) {
      return new Response(`upload-token-${Math.random()}`, { status: 200 });
    }

    if (url.endsWith('/mediaItems:batchCreate')) {
      batchAttempt += 1;
      const body = JSON.parse(String(init?.body)) as { newMediaItems: Array<{ simpleMediaItem: { uploadToken: string } }> };
      const results = body.newMediaItems.map((item, index) => {
        if (batchAttempt === 1 && index === 1) {
          return {
            uploadToken: item.simpleMediaItem.uploadToken,
            status: { message: 'Rejected by Google Photos' }
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

  await executeExportJob(job.job.id);
  const failedProgress = getExportProgress(job.job.id);
  assert.equal(failedProgress?.status, 'failed');
  assert.equal(failedProgress?.completed, 1);
  assert.equal(failedProgress?.failed, 1);

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
  assert.equal(progress?.recentItems[0].status, 'skipped');
  assert.match(progress?.recentItems[0].lastError ?? '', /not supported/);
});
