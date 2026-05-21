import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { MAX_JSON_BODY_BYTES } from '../src/http/localAccess.js';
import { resetDbForTests } from '../src/state/db.js';
import { createBackendServer } from '../src/index.js';

type TestResponse = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-http-security-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');

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
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
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
});

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
