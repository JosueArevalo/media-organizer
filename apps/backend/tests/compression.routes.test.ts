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

const createJsonRequest = (payload: unknown) => {
  const request = Readable.from([JSON.stringify(payload)]) as IncomingMessage;
  request.method = 'POST';
  return request;
};

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
