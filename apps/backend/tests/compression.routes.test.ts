import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleCompressionRoutes } from '../src/pipeline/compression/compression.routes.js';
import { resetDbForTests } from '../src/state/db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-compression-routes-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDbPath = path.join(tempDataDir, 'test.sqlite');
const migrationsDir = path.resolve(process.cwd(), 'src', 'state', 'migrations');
const sourceDir = path.join(tempRoot, 'source');
const outputDir = path.join(tempRoot, 'output');

type CapturedResponse = {
  statusCode: number;
  body: string;
};

const createRequest = (method: string, payload?: unknown) => {
  const body = payload === undefined ? [] : [JSON.stringify(payload)];
  const request = Readable.from(body) as IncomingMessage;
  request.method = method;
  return request;
};

const createJsonRequest = (payload: unknown) => createRequest('POST', payload);

const createResponse = () => {
  let resolveResponse: (response: CapturedResponse) => void;
  const responsePromise = new Promise<CapturedResponse>((resolve) => {
    resolveResponse = resolve;
  });
  const response = {
    statusCode: 200,
    writeHead(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    end(body: string) {
      resolveResponse({ statusCode: this.statusCode, body });
      return this;
    }
  } as ServerResponse & { statusCode: number };

  return { response, responsePromise };
};

beforeEach(() => {
  process.env.MEDIA_ORGANIZER_DATA_DIR = tempDataDir;
  process.env.MEDIA_ORGANIZER_DB_PATH = tempDbPath;
  process.env.MEDIA_ORGANIZER_MIGRATIONS_DIR = migrationsDir;
  resetDbForTests();
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
});

test('compression session route forwards optional HEIC tool commands into the manifest', async () => {
  const { response, responsePromise } = createResponse();
  const handled = handleCompressionRoutes({
    req: createJsonRequest({
      sourceDir,
      outputDir,
      imageQuality: 80,
      imageProfileLabel: 'Balanced',
      videoPresetLabel: 'Fast 1080p30',
      videoOutputFormatMode: 'mp4',
      imageToolCommand: 'cjpeg-static.exe',
      videoToolCommand: 'HandBrakeCLI.exe',
      imageMagickCommand: 'D:\\Tools\\ImageMagick\\magick.exe',
      exifToolCommand: 'D:\\Tools\\ExifTool\\exiftool.exe'
    }),
    res: response,
    requestUrl: new URL('http://localhost/api/compression/sessions')
  });

  assert.equal(handled, true);

  const captured = await responsePromise;
  assert.equal(captured.statusCode, 201);

  const payload = JSON.parse(captured.body) as {
    manifest: {
      imageMagickCommand: string;
      exifToolCommand: string;
      videoOutputFormatMode: string;
    };
  };

  assert.equal(payload.manifest.imageMagickCommand, 'D:\\Tools\\ImageMagick\\magick.exe');
  assert.equal(payload.manifest.exifToolCommand, 'D:\\Tools\\ExifTool\\exiftool.exe');
  assert.equal(payload.manifest.videoOutputFormatMode, 'mp4');
});

test('active session route returns the latest resumable compression session with progress', async () => {
  const { startCompressionSession } = await import('../src/pipeline/compression/compressionJob.service.js?routes-active=1');
  const started = startCompressionSession({
    sourceDir,
    outputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: '__missing_video_encoder__'
  });

  const { response, responsePromise } = createResponse();
  const handled = handleCompressionRoutes({
    req: createRequest('GET'),
    res: response,
    requestUrl: new URL('http://localhost/api/compression/active-session')
  });

  assert.equal(handled, true);

  const captured = await responsePromise;
  assert.equal(captured.statusCode, 200);

  const payload = JSON.parse(captured.body) as {
    session: { id: string; status: string };
    progress: { sessionId: string; status: string };
  };

  assert.ok(payload.session.id);
  assert.equal(payload.session.status, 'running');
  assert.equal(payload.progress.sessionId, payload.session.id);
  assert.equal(payload.progress.status, 'running');
  assert.ok(started.session.id);
});

test('resume route accepts a resumable session and returns initial progress', async () => {
  const { startCompressionSession, reconcileInterruptedCompressionSessions } = await import('../src/pipeline/compression/compressionJob.service.js?routes-resume=1');
  const started = startCompressionSession({
    sourceDir,
    outputDir,
    imageQuality: 80,
    imageProfileLabel: 'Balanced',
    videoPresetLabel: 'Fast 1080p30',
    imageToolCommand: '__missing_image_encoder__',
    videoToolCommand: '__missing_video_encoder__'
  });
  reconcileInterruptedCompressionSessions();

  const { response, responsePromise } = createResponse();
  const handled = handleCompressionRoutes({
    req: createRequest('POST'),
    res: response,
    requestUrl: new URL(`http://localhost/api/compression/sessions/${started.session.id}/resume`)
  });

  assert.equal(handled, true);

  const captured = await responsePromise;
  assert.equal(captured.statusCode, 202);

  const payload = JSON.parse(captured.body) as {
    accepted: boolean;
    session: { id: string; status: string };
    progress: { sessionId: string; status: string } | null;
  };

  assert.equal(payload.accepted, true);
  assert.equal(payload.session.id, started.session.id);
  assert.equal(payload.session.status, 'running');
  assert.equal(payload.progress?.sessionId, started.session.id);
});
