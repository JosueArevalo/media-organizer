import { createServer } from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { readdir, rm, stat } from 'node:fs/promises';
import { runMigrations } from './state/migrations/runMigrations.js';
import { getDb, getDbPath } from './state/db.js';
import { getCompressionSession, startCompressionSession, getCompressionProgress } from './pipeline/compression/compressionJob.service.js';
import { executeCompressionSession } from './pipeline/compression/compressionJob.runner.js';
import {
  getGroupingProgress,
  getGroupingSession,
  pauseGroupingSession,
  resumeGroupingSession,
  startGroupingSession
} from './pipeline/grouping/groupingJob.service.js';
import {
  applyGroupingWorkspace,
  assignGroupingItems,
  createFolderFromTemplate,
  createGroupingFolder,
  createGroupingTemplate,
  createGroupingWorkspace,
  deleteGroupingFolder,
  deleteGroupingTemplate,
  getGroupingMediaPath,
  getGroupingWorkspace,
  listGroupingTemplates,
  renameGroupingFolder,
  updateGroupingTemplate
} from './pipeline/grouping/groupingWorkspace.service.js';
import { scanSourceTreeByPath } from './pipeline/source/sourceTreeScan.service.js';
import { resolveToolCommand } from './pipeline/compression/toolCommandResolver.js';
import { listHandBrakePresets } from './pipeline/compression/handbrakePresets.service.js';
import { isAllowedPickerOrigin, pickDirectory, pickFile, type SystemPickerFilter } from './system/systemPicker.service.js';

const port = Number(process.env.PORT ?? 4000);

const appliedMigrations = runMigrations();

const sendJson = (res: import('node:http').ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range'
  });
  res.end(JSON.stringify(payload));
};

const sendEmpty = (res: import('node:http').ServerResponse, status: number) => {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range'
  });
  res.end();
};

const getMediaContentType = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();

  if (['.jpg', '.jpeg'].includes(extension)) return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.mp4' || extension === '.m4v') return 'video/mp4';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.mkv') return 'video/x-matroska';

  return 'application/octet-stream';
};

const streamMediaFile = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  filePath: string
) => {
  const stats = fs.statSync(filePath);
  const range = req.headers.range;
  const headersBase = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Accept-Ranges': 'bytes',
    'Content-Type': getMediaContentType(filePath)
  };

  if (!range) {
    res.writeHead(200, {
      ...headersBase,
      'Content-Length': stats.size
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);

  if (!match) {
    res.writeHead(416, headersBase);
    res.end();
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stats.size - 1;

  if (start >= stats.size || end >= stats.size || start > end) {
    res.writeHead(416, {
      ...headersBase,
      'Content-Range': `bytes */${stats.size}`
    });
    res.end();
    return;
  }

  res.writeHead(206, {
    ...headersBase,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${stats.size}`
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
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

const isPickerFilter = (filter: unknown): filter is SystemPickerFilter => {
  if (!filter || typeof filter !== 'object') {
    return false;
  }

  const candidate = filter as { name?: unknown; extensions?: unknown };
  return (
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.extensions) &&
    candidate.extensions.every((extension) => typeof extension === 'string')
  );
};

const sendPickerResult = (res: import('node:http').ServerResponse, result: Awaited<ReturnType<typeof pickDirectory>>) => {
  if (result.status === 'unsupported') {
    sendJson(res, 501, result);
    return;
  }

  sendJson(res, 200, result);
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
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range'
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

  if (requestUrl.pathname === '/api/grouping/workspace' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as
          | {
              name?: string;
              sourceDir?: string;
              outputDir?: string;
              compressionSessionId?: string;
            }
          | null;

        if (!body?.sourceDir || !body?.outputDir || !body.compressionSessionId) {
          sendJson(res, 400, {
            status: 'invalid_request',
            message: 'sourceDir, outputDir, and compressionSessionId are required.'
          });
          return;
        }

        sendJson(
          res,
          201,
          createGroupingWorkspace({
            name: body.name,
            sourceDir: body.sourceDir,
            outputDir: body.outputDir,
            compressionSessionId: body.compressionSessionId
          })
        );
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not create grouping workspace.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname.startsWith('/api/grouping/templates')) {
    void (async () => {
      try {
        const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
        const templateId = pathSegments[3];

        if (req.method === 'GET' && !templateId) {
          sendJson(res, 200, { templates: listGroupingTemplates() });
          return;
        }

        if (req.method === 'POST' && !templateId) {
          const body = (await readRequestJson(req)) as { name?: string; pattern?: string; enabled?: boolean } | null;

          if (!body?.name || !body.pattern) {
            sendJson(res, 400, { status: 'invalid_request', message: 'name and pattern are required.' });
            return;
          }

          sendJson(res, 201, { templates: createGroupingTemplate({ name: body.name, pattern: body.pattern, enabled: body.enabled }) });
          return;
        }

        if (req.method === 'PATCH' && templateId) {
          const body = (await readRequestJson(req)) as Partial<{ name: string; pattern: string; enabled: boolean }> | null;
          const templates = updateGroupingTemplate(templateId, body ?? {});

          if (!templates) {
            sendJson(res, 404, { status: 'not_found' });
            return;
          }

          sendJson(res, 200, { templates });
          return;
        }

        if (req.method === 'DELETE' && templateId) {
          if (!deleteGroupingTemplate(templateId)) {
            sendJson(res, 404, { status: 'not_found' });
            return;
          }

          sendEmpty(res, 204);
          return;
        }

        sendJson(res, 404, { status: 'not_found' });
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not update grouping templates.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/grouping/start' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as
          | {
              name?: string;
              sourceDir?: string;
              outputDir?: string;
              compressionSessionId?: string;
              strategy?: 'date' | 'source-kind';
              autoRename?: boolean;
            }
          | null;

        if (!body?.sourceDir || !body?.outputDir) {
          sendJson(res, 400, { status: 'invalid_request', message: 'sourceDir and outputDir are required.' });
          return;
        }

        const result = startGroupingSession({
          name: body.name,
          sourceDir: body.sourceDir,
          outputDir: body.outputDir,
          compressionSessionId: body.compressionSessionId,
          strategy: body.strategy,
          autoRename: body.autoRename
        });

        sendJson(res, 201, result);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to start grouping session.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname.startsWith('/api/grouping/') && ['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method ?? '')) {
    const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
    const sessionId = pathSegments[2];
    const subPath = pathSegments[3];
    const subId = pathSegments[4];
    const tailPath = pathSegments[5];

    if (!sessionId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return;
    }

    if (req.method === 'GET' && subPath === 'progress') {
      const progress = getGroupingProgress(sessionId);

      if (!progress) {
        sendJson(res, 404, { status: 'not_found' });
        return;
      }

      sendJson(res, 200, progress);
      return;
    }

    if (req.method === 'GET' && subPath === 'workspace') {
      const workspace = getGroupingWorkspace(sessionId);

      if (!workspace) {
        sendJson(res, 404, { status: 'not_found' });
        return;
      }

      sendJson(res, 200, workspace);
      return;
    }

    if (req.method === 'POST' && subPath === 'folders') {
      void (async () => {
        try {
          const body = (await readRequestJson(req)) as { label?: string; templateId?: string } | null;

          if (body?.templateId) {
            const folder = createFolderFromTemplate(sessionId, body.templateId);

            if (!folder) {
              sendJson(res, 404, { status: 'not_found', message: 'Template not found.' });
              return;
            }

            sendJson(res, 201, folder);
            return;
          }

          if (!body?.label) {
            sendJson(res, 400, { status: 'invalid_request', message: 'label is required.' });
            return;
          }

          sendJson(res, 201, createGroupingFolder(sessionId, body.label));
        } catch (error) {
          sendJson(res, 500, {
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not create folder.'
          });
        }
      })();

      return;
    }

    if (req.method === 'PATCH' && subPath === 'folders' && subId) {
      void (async () => {
        try {
          const body = (await readRequestJson(req)) as { label?: string } | null;

          if (!body?.label) {
            sendJson(res, 400, { status: 'invalid_request', message: 'label is required.' });
            return;
          }

          const folder = renameGroupingFolder(sessionId, subId, body.label);

          if (!folder) {
            sendJson(res, 404, { status: 'not_found' });
            return;
          }

          sendJson(res, 200, folder);
        } catch (error) {
          sendJson(res, 500, {
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not rename folder.'
          });
        }
      })();

      return;
    }

    if (req.method === 'DELETE' && subPath === 'folders' && subId) {
      try {
        if (!deleteGroupingFolder(sessionId, subId)) {
          sendJson(res, 404, { status: 'not_found' });
          return;
        }

        sendEmpty(res, 204);
      } catch (error) {
        sendJson(res, 409, {
          status: 'conflict',
          message: error instanceof Error ? error.message : 'Could not delete folder.'
        });
      }

      return;
    }

    if (req.method === 'POST' && subPath === 'items' && subId === 'assign') {
      void (async () => {
        try {
          const body = (await readRequestJson(req)) as { itemIds?: string[]; targetGroupLabel?: string } | null;

          if (!Array.isArray(body?.itemIds) || !body.targetGroupLabel) {
            sendJson(res, 400, { status: 'invalid_request', message: 'itemIds and targetGroupLabel are required.' });
            return;
          }

          sendJson(res, 200, assignGroupingItems(sessionId, body.itemIds, body.targetGroupLabel));
        } catch (error) {
          sendJson(res, 500, {
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not assign items.'
          });
        }
      })();

      return;
    }

    if (req.method === 'POST' && subPath === 'apply') {
      try {
        const result = applyGroupingWorkspace(sessionId);

        if (!result) {
          sendJson(res, 404, { status: 'not_found' });
          return;
        }

        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not apply grouping workspace.'
        });
      }

      return;
    }

    if (req.method === 'GET' && subPath === 'items' && subId && tailPath === 'media') {
      try {
        const media = getGroupingMediaPath(sessionId, subId);

        if (!media || !fs.existsSync(media.path)) {
          sendJson(res, 404, { status: 'not_found' });
          return;
        }

        streamMediaFile(req, res, media.path);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not stream media.'
        });
      }

      return;
    }

    if (req.method === 'POST' && subPath === 'pause') {
      const session = pauseGroupingSession(sessionId);

      if (!session) {
        sendJson(res, 404, { status: 'not_found' });
        return;
      }

      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'POST' && subPath === 'resume') {
      const session = resumeGroupingSession(sessionId);

      if (!session) {
        sendJson(res, 404, { status: 'not_found' });
        return;
      }

      sendJson(res, 200, session);
      return;
    }

    if (req.method === 'GET' && !subPath) {
      const session = getGroupingSession(sessionId);

      if (!session) {
        sendJson(res, 404, { status: 'not_found' });
        return;
      }

      sendJson(res, 200, session);
      return;
    }

    sendJson(res, 404, { status: 'not_found' });
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

  if (requestUrl.pathname === '/api/system/picker/directory' && req.method === 'POST') {
    void (async () => {
      try {
        if (!isAllowedPickerOrigin(req.headers.origin)) {
          sendJson(res, 403, {
            status: 'forbidden',
            message: 'Native pickers are only available to the local app.'
          });
          return;
        }

        const body = (await readRequestJson(req)) as { title?: unknown; initialPath?: unknown } | null;
        const result = await pickDirectory({
          title: typeof body?.title === 'string' ? body.title : undefined,
          initialPath: typeof body?.initialPath === 'string' ? body.initialPath : undefined
        });

        sendPickerResult(res, result);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not open folder picker.'
        });
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/system/picker/file' && req.method === 'POST') {
    void (async () => {
      try {
        if (!isAllowedPickerOrigin(req.headers.origin)) {
          sendJson(res, 403, {
            status: 'forbidden',
            message: 'Native pickers are only available to the local app.'
          });
          return;
        }

        const body = (await readRequestJson(req)) as {
          title?: unknown;
          initialPath?: unknown;
          filters?: unknown;
        } | null;
        const result = await pickFile({
          title: typeof body?.title === 'string' ? body.title : undefined,
          initialPath: typeof body?.initialPath === 'string' ? body.initialPath : undefined,
          filters: Array.isArray(body?.filters) ? body.filters.filter(isPickerFilter) : undefined
        });

        sendPickerResult(res, result);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not open file picker.'
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
