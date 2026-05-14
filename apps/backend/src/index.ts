import { createServer } from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import { readdir, rm, stat } from 'node:fs/promises';
import { runMigrations } from './state/migrations/runMigrations.js';
import { getDb, getDbPath } from './state/db.js';
import { getCompressionSession, startCompressionSession, getCompressionProgress } from './pipeline/compression/compressionJob.service.js';
import { executeCompressionSession } from './pipeline/compression/compressionJob.runner.js';
import { scanSourceTreeByPath } from './pipeline/source/sourceTreeScan.service.js';
import { resolveToolCommand } from './pipeline/compression/toolCommandResolver.js';
import { listHandBrakePresets } from './pipeline/compression/handbrakePresets.service.js';

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

const clearDirectoryContents = async (directoryPath: string) => {
  const entries = await readdir(directoryPath, { withFileTypes: true });

  await Promise.all(
    entries.map((entry) => rm(path.join(directoryPath, entry.name), { recursive: true, force: true }))
  );

  return entries.length;
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

  if (requestUrl.pathname === '/api/compression/sessions' && req.method === 'POST') {
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
              imageToolCommand?: string;
              videoToolCommand?: string;
              selectionScope?: {
                excludedDirectories: string[];
                excludedFiles: string[];
                includedDirectories: string[];
                includedFiles: string[];
                updatedAt: number;
              } | null;
            }
          | null;

        if (!body?.sourceDir || !body?.outputDir || typeof body.imageQuality !== 'number' || !body.imageProfileLabel || !body.videoPresetLabel) {
          sendJson(res, 400, { status: 'invalid_request' });
          return;
        }

        const result = startCompressionSession({
          name: body.name,
          sourceDir: body.sourceDir,
          outputDir: body.outputDir,
          imageQuality: body.imageQuality,
          imageProfileLabel: body.imageProfileLabel,
          videoPresetLabel: body.videoPresetLabel,
          imageToolCommand: body.imageToolCommand,
          videoToolCommand: body.videoToolCommand,
          selectionScope: body.selectionScope ?? undefined
        });

        void executeCompressionSession(result.session.id).catch((error) => {
          console.error(`[backend] compression session ${result.session.id} failed`, error);
        });

        sendJson(res, 201, result);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to start compression session.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/source-tree/scan' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as { sourcePath?: string } | null;

        if (!body?.sourcePath || !body.sourcePath.trim()) {
          sendJson(res, 400, { status: 'invalid_request', message: 'sourcePath is required.' });
          return;
        }

        const tree = await scanSourceTreeByPath(body.sourcePath.trim());
        sendJson(res, 200, { tree });
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not scan source path.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/system/maintenance/clear-destination' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as { destinationPath?: string; sourcePath?: string } | null;
        const destinationPath = body?.destinationPath?.trim();
        const sourcePath = body?.sourcePath?.trim();

        if (!destinationPath || !path.isAbsolute(destinationPath)) {
          sendJson(res, 400, { status: 'invalid_request', message: 'destinationPath must be an absolute path.' });
          return;
        }

        const destinationResolved = path.resolve(destinationPath);
        const sourceResolved = sourcePath && path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : null;

        if (sourceResolved && sourceResolved === destinationResolved) {
          sendJson(res, 400, {
            status: 'invalid_request',
            message: 'Destination path cannot be the same as source path.'
          });
          return;
        }

        const destinationStats = await stat(destinationResolved).catch(() => null);

        if (!destinationStats || !destinationStats.isDirectory()) {
          sendJson(res, 400, {
            status: 'invalid_request',
            message: 'Destination path was not found or is not a directory.'
          });
          return;
        }

        const deletedEntries = await clearDirectoryContents(destinationResolved);

        sendJson(res, 200, {
          status: 'ok',
          destinationPath: destinationResolved,
          deletedEntries
        });
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not clear destination folder.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/system/maintenance/reset-persistent-state' && req.method === 'POST') {
    void (async () => {
      try {
        const db = getDb();

        db.exec(`
          BEGIN TRANSACTION;
          DELETE FROM session_checkpoints;
          DELETE FROM item_stage_status;
          DELETE FROM item_decisions;
          DELETE FROM media_items;
          DELETE FROM sessions;
          COMMIT;
        `);

        sendJson(res, 200, {
          status: 'ok',
          cleared: ['sessions', 'media_items', 'item_decisions', 'item_stage_status', 'session_checkpoints']
        });
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not reset backend persistent state.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/system/maintenance/resolve-command' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as { command?: string } | null;
        const command = body?.command?.trim() ?? '';

        if (!command) {
          sendJson(res, 400, { status: 'invalid_request', message: 'command is required.' });
          return;
        }

        const resolvedPath = resolveToolCommand(command);
        sendJson(res, 200, {
          status: 'ok',
          command,
          resolvedPath
        });
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not resolve command path.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/system/tools/handbrake/presets' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as { command?: string } | null;
        const presets = await listHandBrakePresets(body?.command);

        sendJson(res, 200, {
          status: 'ok',
          ...presets
        });
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load HandBrake presets.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname.startsWith('/api/compression/sessions/') && req.method === 'GET') {
    const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
    const sessionId = pathSegments[3];
    const subPath = pathSegments[4];

    if (!sessionId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return;
    }

    // Check if this is a progress request
    if (subPath === 'progress') {
      const progress = getCompressionProgress(sessionId);

      if (!progress) {
        sendJson(res, 404, { status: 'not_found' });
        return;
      }

      sendJson(res, 200, progress);
      return;
    }

    // Otherwise, get the session
    const session = getCompressionSession(sessionId);

    if (!session) {
      sendJson(res, 404, { status: 'not_found' });
      return;
    }

    sendJson(res, 200, session);
    return;
  }

  sendJson(res, 404, {
    status: 'not_found'
  });
});

server.listen(port, () => {
  console.log(`[backend] running at http://localhost:${port}`);
});
