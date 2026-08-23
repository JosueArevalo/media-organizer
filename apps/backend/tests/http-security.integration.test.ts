import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, afterEach, beforeEach, test } from 'node:test';
import sharp from 'sharp';
import { MAX_JSON_BODY_BYTES } from '../src/http/localAccess.js';
import { getDb, resetDbForTests } from '../src/state/db.js';
import { createBackendServer } from '../src/index.js';
import { getActiveGroupingMediaOperations } from '../src/pipeline/grouping/groupingMediaDiagnostics.js';

type TestResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  bytes: Buffer;
};

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-http-security-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');
const originalConsoleWarn = console.warn;

let server: Server | null = null;
let basePort = 0;

const listen = async () => {
  server = createBackendServer();

  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  basePort = address.port;
};

const closeServer = async () => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  server = null;
};

const request = async (input: {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}): Promise<TestResponse> => {
  const body = input.body ?? '';

  return await new Promise<TestResponse>((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: basePort,
        path: input.path,
        method: input.method ?? 'GET',
        headers: {
          Host: `127.0.0.1:${basePort}`,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...input.headers
        }
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: bytes.toString('utf8'),
            bytes
          });
        });
      }
    );

    req.on('error', reject);

    if (body) {
      req.write(body);
    }

    req.end();
  });
};

const writeFakeMagick = (toolsDir: string) => {
  const extension = process.platform === 'win32' ? '.cmd' : '.sh';
  const filePath = path.join(toolsDir, `magick-thumbnail${extension}`);
  const script = process.platform === 'win32'
    ? `@echo off
if "%~1"=="identify" (
  echo JPEG RW
  exit /b 0
)
set "last="
for %%A in (%*) do set "last=%%~A"
echo preview > "%last%"
exit /b 0
`
    : `#!/usr/bin/env sh
if [ "$1" = "identify" ]; then
  echo "JPEG RW"
  exit 0
fi
last=""
for arg in "$@"; do
  last="$arg"
done
printf 'preview\\n' > "$last"
`;

  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(filePath, script, 'utf8');

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }

  return filePath;
};

const seedCompressionSession = (input: {
  sourceDir: string;
  outputDir: string;
  relativePath: string;
  imageMagickCommand: string;
  mediaType?: 'image' | 'video';
  outputContent?: string | Buffer;
}) => {
  const db = getDb();
  const now = new Date().toISOString();
  const compressionSessionId = randomUUID();
  const itemId = randomUUID();
  const sourcePath = path.join(input.sourceDir, input.relativePath);
  const outputPath = path.join(input.outputDir, input.relativePath);

  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(sourcePath, input.outputContent ?? 'source image');
  fs.writeFileSync(outputPath, input.outputContent ?? 'output image');

  db.prepare(
    `
      INSERT INTO sessions (id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at)
      VALUES (?, 'Compression source', ?, ?, 'completed', ?, ?, ?)
    `
  ).run(compressionSessionId, input.sourceDir, input.outputDir, now, now, now);

  db.prepare(
    `
      INSERT INTO media_items (
        id,
        session_id,
        source_path,
        relative_path,
        media_type,
        source_kind_detected,
        source_kind_override,
        size_bytes,
        capture_time,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'camera', NULL, 100, NULL, ?, ?)
    `
  ).run(itemId, compressionSessionId, sourcePath, input.relativePath, input.mediaType ?? 'image', now, now);

  db.prepare(
    `
      INSERT INTO item_decisions (
        id,
        session_id,
        item_id,
        selected_for_compression,
        selected_for_output,
        target_group_label,
        user_overridden,
        updated_at
      ) VALUES (?, ?, ?, 1, 1, NULL, 0, ?)
    `
  ).run(randomUUID(), compressionSessionId, itemId, now);

  db.prepare(
    `
      INSERT INTO item_stage_status (
        id,
        session_id,
        item_id,
        stage,
        status,
        attempt_count,
        last_error,
        updated_at
      ) VALUES (?, ?, ?, 'compress', 'completed', 1, NULL, ?)
    `
  ).run(randomUUID(), compressionSessionId, itemId, now);

  db.prepare(
    `
      INSERT INTO session_checkpoints (id, session_id, stage, cursor, payload_json, updated_at)
      VALUES (?, ?, 'compress', NULL, ?, ?)
    `
  ).run(
    randomUUID(),
    compressionSessionId,
    JSON.stringify({
      outputRoot: input.outputDir,
      manifest: {
        imageMagickCommand: input.imageMagickCommand
      }
    }),
    now
  );

  return compressionSessionId;
};

const createGroupingVideo = async (extension: 'mp4' | 'mov', content: Buffer, label: string) => {
  const sourceDir = path.join(tempRoot, `${label}-${extension}-source`);
  const outputDir = path.join(tempRoot, `${label}-${extension}-output`);
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  const compressionSessionId = seedCompressionSession({
    sourceDir,
    outputDir,
    relativePath: `clip.${extension}`,
    imageMagickCommand: '',
    mediaType: 'video',
    outputContent: content
  });
  const workspaceResponse = await request({
    method: 'POST',
    path: '/api/grouping/workspace',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceDir, outputDir, compressionSessionId })
  });
  assert.equal(workspaceResponse.statusCode, 201);
  const workspace = JSON.parse(workspaceResponse.body) as { sessionId: string; items: Array<{ id: string }> };
  return `/api/grouping/${workspace.sessionId}/items/${workspace.items[0].id}/media`;
};

beforeEach(async () => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  fs.rmSync(tempDbPath, { force: true });
  resetDbForTests();
  await listen();
});

afterEach(async () => {
  await closeServer();
  resetDbForTests();
  console.warn = originalConsoleWarn;
});

after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('rejects requests from external origins', async () => {
  const response = await request({
    path: '/api/health',
    headers: {
      Origin: 'https://example.com'
    }
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body, /localhost/);
});

test('rejects requests with non-local Host headers', async () => {
  const response = await request({
    path: '/api/health',
    headers: {
      Host: '192.168.1.20:4000'
    }
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body, /localhost/);
});

test('local CORS response reflects the local origin and never uses wildcard', async () => {
  const origin = 'http://127.0.0.1:5173';
  const response = await request({
    path: '/api/health',
    headers: {
      Origin: origin
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.notEqual(response.headers['access-control-allow-origin'], '*');
});

test('grouping thumbnail endpoint returns a cached JPEG preview', async () => {
  const sourceDir = path.join(tempRoot, 'thumbnail-source');
  const outputDir = path.join(tempRoot, 'thumbnail-output');
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const compressionSessionId = seedCompressionSession({
    sourceDir,
    outputDir,
    relativePath: 'photo.jpg',
    imageMagickCommand: ''
  });
  await sharp({
    create: {
      width: 720,
      height: 480,
      channels: 3,
      background: { r: 32, g: 96, b: 160 }
    }
  }).jpeg().toFile(path.join(outputDir, 'photo.jpg'));

  const workspaceResponse = await request({
    method: 'POST',
    path: '/api/grouping/workspace',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceDir,
      outputDir,
      compressionSessionId
    })
  });

  assert.equal(workspaceResponse.statusCode, 201);
  const workspace = JSON.parse(workspaceResponse.body) as { sessionId: string; items: Array<{ id: string }> };
  const thumbnailResponse = await request({
    path: `/api/grouping/${workspace.sessionId}/items/${workspace.items[0].id}/thumbnail`
  });

  assert.equal(thumbnailResponse.statusCode, 200);
  assert.equal(thumbnailResponse.headers['content-type'], 'image/jpeg');
  assert.equal(thumbnailResponse.headers['cache-control'], 'private, max-age=86400');
  assert.ok(Number(thumbnailResponse.headers['content-length']) > 0);
});

for (const extension of ['mp4', 'mov'] as const) {
  test(`grouping ${extension.toUpperCase()} media serves complete, ranged, suffix and HEAD responses`, async () => {
    const content = Buffer.from('0123456789abcdef');
    const mediaPath = await createGroupingVideo(extension, content, 'video-http');
    const expectedType = extension === 'mp4' ? 'video/mp4' : 'video/quicktime';

    const complete = await request({ path: `${mediaPath}?usage=poster` });
    assert.equal(complete.statusCode, 206);
    assert.equal(complete.headers['content-type'], expectedType);
    assert.equal(complete.headers['accept-ranges'], 'bytes');
    assert.equal(complete.headers['cache-control'], 'no-store');
    assert.equal(complete.headers['content-length'], String(content.length));
    assert.equal(complete.headers['content-range'], `bytes 0-15/${content.length}`);
    assert.notEqual(complete.headers.connection, 'close');
    assert.deepEqual(complete.bytes, content);

    const initial = await request({ path: mediaPath, headers: { Range: 'bytes=0-3' } });
    assert.equal(initial.statusCode, 206);
    assert.equal(initial.headers['content-length'], '4');
    assert.equal(initial.headers['cache-control'], 'no-store');
    assert.equal(initial.headers['content-range'], `bytes 0-3/${content.length}`);
    assert.deepEqual(initial.bytes, content.subarray(0, 4));

    const open = await request({ path: mediaPath, headers: { Range: 'bytes=10-' } });
    assert.equal(open.statusCode, 206);
    assert.equal(open.headers['content-range'], `bytes 10-15/${content.length}`);
    assert.deepEqual(open.bytes, content.subarray(10));

    const suffix = await request({ path: mediaPath, headers: { Range: 'bytes=-5' } });
    assert.equal(suffix.statusCode, 206);
    assert.equal(suffix.headers['content-range'], `bytes 11-15/${content.length}`);
    assert.deepEqual(suffix.bytes, content.subarray(-5));

    const clamped = await request({ path: mediaPath, headers: { Range: 'bytes=12-999' } });
    assert.equal(clamped.statusCode, 206);
    assert.equal(clamped.headers['content-range'], `bytes 12-15/${content.length}`);
    assert.deepEqual(clamped.bytes, content.subarray(12));

    const head = await request({ method: 'HEAD', path: mediaPath });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers['content-type'], expectedType);
    assert.equal(head.headers['content-length'], String(content.length));
    assert.equal(head.bytes.length, 0);

    const invalid = await request({ path: mediaPath, headers: { Range: 'bytes=99-' } });
    assert.equal(invalid.statusCode, 416);
    assert.equal(invalid.headers['content-range'], `bytes */${content.length}`);
    assert.equal(invalid.headers['content-length'], '0');
    assert.equal(invalid.bytes.length, 0);
  });
}

test('grouping poster requests without a range are capped at 12 MiB', async () => {
  const posterLimit = 12 * 1024 * 1024;
  const mediaPath = await createGroupingVideo(
    'mp4',
    Buffer.alloc(posterLimit + 1024, 'p'),
    'poster-limit'
  );
  const response = await request({ path: `${mediaPath}?usage=poster` });

  assert.equal(response.statusCode, 206);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['content-length'], String(posterLimit));
  assert.equal(response.headers['content-range'], `bytes 0-${posterLimit - 1}/${posterLimit + 1024}`);
  assert.equal(response.bytes.length, posterLimit);
});

test('backend health remains responsive while a video poster is served', async () => {
  const mediaPath = await createGroupingVideo('mp4', Buffer.alloc(2 * 1024 * 1024, 'p'), 'poster-health');
  const posterPromise = request({
    path: `${mediaPath}?usage=poster`,
    headers: { Range: 'bytes=0-1048575' }
  });
  const startedAt = Date.now();
  const health = await request({ path: '/api/health' });

  assert.equal(health.statusCode, 200);
  assert.ok(Date.now() - startedAt < 500);
  assert.equal((await posterPromise).statusCode, 206);
});

test('closing a grouping media response releases its stream and keeps health responsive', async () => {
  const mediaPath = await createGroupingVideo('mov', Buffer.alloc(4 * 1024 * 1024, 'c'), 'video-cancel');
  const clientRequest = http.request({
    hostname: '127.0.0.1',
    port: basePort,
    path: mediaPath,
    headers: { Host: `127.0.0.1:${basePort}` }
  });

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    clientRequest.once('response', resolve);
    clientRequest.once('error', reject);
    clientRequest.end();
  });
  response.pause();
  assert.equal(response.statusCode, 200);
  assert.equal(getActiveGroupingMediaOperations().length, 1);

  const health = await request({ path: '/api/health' });
  assert.equal(health.statusCode, 200);

  response.destroy();
  clientRequest.destroy();
  const releasedBefore = Date.now() + 1_000;
  while (getActiveGroupingMediaOperations().length > 0 && Date.now() < releasedBefore) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(getActiveGroupingMediaOperations().length, 0);
});

test('backend health offline reports are logged for local diagnostics', async () => {
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.join(' '));
  };

  const healthResponse = await request({
    path: '/api/health'
  });

  assert.equal(healthResponse.statusCode, 200);

  const response = await request({
    method: 'POST',
    path: '/api/health/offline-report',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      previousStatus: 'online',
      status: 'offline',
      failureKind: 'timeout',
      errorMessage: 'The operation was aborted.',
      consecutiveFailures: 4,
      consecutiveSuccesses: 0,
      lastCheckedAt: 1000,
      lastOkAt: 500,
      msSinceLastOk: 500,
      timeoutMs: 1500,
      healthUrl: 'http://localhost:4000/api/health'
    })
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /"status":"ok"/);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\[backend-health\] offline/);
  assert.match(messages[0], /kind=timeout/);
  assert.match(messages[0], /fails=4/);
  assert.match(messages[0], /timeout=1500ms/);
  assert.match(messages[0], /url=http:\/\/localhost:4000\/api\/health/);
  assert.match(messages[0], /recent=#\d+:ok\/200\/\d+ms\/\d+ms-ago/);
});

test('oversized JSON request bodies return 413', async () => {
  const response = await request({
    method: 'POST',
    path: '/api/source-tree/scan',
    headers: {
      'Content-Type': 'application/json'
    },
    body: Buffer.alloc(MAX_JSON_BODY_BYTES + 1, 'a')
  });

  assert.equal(response.statusCode, 413);
  assert.match(response.body, /payload_too_large/);
});

test('clear-destination without confirmation returns 400 and does not delete files', async () => {
  const destinationPath = path.join(tempRoot, 'destination-without-confirmation');
  const existingFile = path.join(destinationPath, 'keep.txt');
  fs.mkdirSync(destinationPath, { recursive: true });
  fs.writeFileSync(existingFile, 'keep me', 'utf8');

  const response = await request({
    method: 'POST',
    path: '/api/system/maintenance/clear-destination',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ destinationPath })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(fs.existsSync(existingFile), true);
});

test('reset-persistent-state without confirmation returns 400', async () => {
  const response = await request({
    method: 'POST',
    path: '/api/system/maintenance/reset-persistent-state',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /RESET_STATE/);
});

test('clear-destination rejects source and destination pointing to the same directory', async () => {
  const destinationPath = path.join(tempRoot, 'same-source-destination');
  fs.mkdirSync(destinationPath, { recursive: true });

  const response = await request({
    method: 'POST',
    path: '/api/system/maintenance/clear-destination',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      destinationPath,
      sourcePath: destinationPath,
      confirmation: 'CLEAR_DESTINATION'
    })
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /same as source/);
});
