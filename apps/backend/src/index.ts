import { createServer } from 'node:http';
import { URL } from 'node:url';
import { runMigrations } from './state/migrations/runMigrations.js';
import { getDbPath } from './state/db.js';
import { getCompressionJob, startCompressionJob } from './pipeline/compression/compressionJob.service.js';

const port = Number(process.env.PORT ?? 4000);

const appliedMigrations = runMigrations();

const sendJson = (res: import('node:http').ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
};

const readRequestJson = async (req: import('node:http').IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw.trim()) {
    return null;
  }

  return JSON.parse(raw) as unknown;
};

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'backend',
      time: new Date().toISOString(),
      dbPath: getDbPath(),
      appliedMigrations
    });
    return;
  }

  if (requestUrl.pathname === '/api/compression/jobs' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as
          | {
              name?: string;
              sourceDir?: string;
              outputDir?: string;
              imageQuality?: number;
              imageProfileLabel?: string;
              videoPresetLabel?: string;
            }
          | null;

        if (!body?.sourceDir || !body?.outputDir || typeof body.imageQuality !== 'number' || !body.imageProfileLabel || !body.videoPresetLabel) {
          sendJson(res, 400, { status: 'invalid_request' });
          return;
        }

        const result = startCompressionJob({
          name: body.name,
          sourceDir: body.sourceDir,
          outputDir: body.outputDir,
          imageQuality: body.imageQuality,
          imageProfileLabel: body.imageProfileLabel,
          videoPresetLabel: body.videoPresetLabel
        });

        sendJson(res, 201, result);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to start compression job.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname.startsWith('/api/compression/jobs/') && req.method === 'GET') {
    const jobId = requestUrl.pathname.split('/').pop();

    if (!jobId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return;
    }

    const job = getCompressionJob(jobId);

    if (!job) {
      sendJson(res, 404, { status: 'not_found' });
      return;
    }

    sendJson(res, 200, job);
    return;
  }

  sendJson(res, 404, {
    status: 'not_found'
  });
});

server.listen(port, () => {
  console.log(`[backend] running at http://localhost:${port}`);
});
