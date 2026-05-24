import { createServer } from 'node:http';
import { pathToFileURL, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './state/migrations/runMigrations.js';
import { getDbPath } from './state/db.js';
import { handleDashboardRoutes } from './dashboard/dashboard.routes.js';
import { handleCompressionRoutes } from './pipeline/compression/compression.routes.js';
import { handleExportRoutes } from './pipeline/export/export.routes.js';
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
  deleteGroupingItems,
  deleteGroupingTemplate,
  getGroupingMediaPath,
  getGroupingWorkspace,
  listGroupingTemplates,
  reorganizeGroupingWorkspace,
  renameGroupingFolder,
  updateGroupingTemplate
} from './pipeline/grouping/groupingWorkspace.service.js';
import { handleSourceTreeRoutes } from './pipeline/source/sourceTree.routes.js';
import { handleSystemRoutes } from './system/system.routes.js';
import {
  getCorsHeaders,
  isAllowedLocalHost,
  isAllowedLocalOrigin
} from './http/localAccess.js';
import { readRequestJson, sendCaughtError, sendEmpty, sendJson } from './http/httpResponses.js';

const port = Number(process.env.PORT ?? 4000);

const sendForbiddenLocalOnly = (res: import('node:http').ServerResponse) => {
  sendJson(res, 403, {
    status: 'forbidden',
    message: 'This local-first API only accepts requests from localhost.'
  });
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

export const createBackendServer = (appliedMigrations = runMigrations()) => createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    if (!isAllowedLocalOrigin(req.headers.origin) || !isAllowedLocalHost(req.headers.host)) {
      sendForbiddenLocalOnly(res);
      return;
    }

    res.writeHead(204, getCorsHeaders(req.headers.origin));
    res.end();
    return;
  }

  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (!isAllowedLocalHost(req.headers.host) || !isAllowedLocalOrigin(req.headers.origin)) {
    sendForbiddenLocalOnly(res);
    return;
  }

  for (const [header, value] of Object.entries(getCorsHeaders(req.headers.origin))) {
    res.setHeader(header, value);
  }

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

  if (
    handleDashboardRoutes({ req, res, requestUrl }) ||
    handleCompressionRoutes({ req, res, requestUrl }) ||
    handleExportRoutes({ req, res, requestUrl }) ||
    handleSourceTreeRoutes({ req, res, requestUrl }) ||
    handleSystemRoutes({ req, res, requestUrl })
  ) {
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
        sendCaughtError(res, error, 'Could not create grouping workspace.');
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
        sendCaughtError(res, error, 'Could not update grouping templates.');
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
              strategy?: 'date' | 'source-folder';
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
        sendCaughtError(res, error, 'Failed to start grouping session.');
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
          sendCaughtError(res, error, 'Could not create folder.');
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
          sendCaughtError(res, error, 'Could not rename folder.');
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
          sendCaughtError(res, error, 'Could not assign items.');
        }
      })();

      return;
    }

    if (req.method === 'POST' && subPath === 'reorganize') {
      void (async () => {
        try {
          const body = (await readRequestJson(req)) as
            | {
                rules?: Array<'date-event-multiple' | 'single-date-year-unique'>;
                strategy?: 'date' | 'source-folder' | null;
                dateOptions?: { singleDateHandling?: 'daily-event' | 'year-unique' | 'keep-original' };
                sourceFolderOptions?: { mode?: 'nearest-folder' | 'relative-path' };
                preservedDirectories?: string[];
                reorganizedDirectories?: string[];
              }
            | null;

          const workspace = reorganizeGroupingWorkspace(sessionId, {
            rules: Array.isArray(body?.rules) ? body.rules : [],
            strategy: body?.strategy ?? null,
            dateOptions:
              body?.dateOptions?.singleDateHandling === 'daily-event' ||
              body?.dateOptions?.singleDateHandling === 'year-unique' ||
              body?.dateOptions?.singleDateHandling === 'keep-original'
                ? { singleDateHandling: body.dateOptions.singleDateHandling }
                : undefined,
            sourceFolderOptions:
              body?.sourceFolderOptions?.mode === 'nearest-folder' || body?.sourceFolderOptions?.mode === 'relative-path'
                ? { mode: body.sourceFolderOptions.mode }
                : undefined,
            preservedDirectories: Array.isArray(body?.preservedDirectories) ? body.preservedDirectories : [],
            reorganizedDirectories: Array.isArray(body?.reorganizedDirectories) ? body.reorganizedDirectories : []
          });

          if (!workspace) {
            sendJson(res, 404, { status: 'not_found' });
            return;
          }

          sendJson(res, 200, workspace);
        } catch (error) {
          sendCaughtError(res, error, 'Could not reorganize workspace.');
        }
      })();

      return;
    }

    if (req.method === 'POST' && subPath === 'items' && subId === 'delete') {
      void (async () => {
        try {
          const body = (await readRequestJson(req)) as { itemIds?: string[] } | null;

          if (!Array.isArray(body?.itemIds)) {
            sendJson(res, 400, { status: 'invalid_request', message: 'itemIds is required.' });
            return;
          }

          sendJson(res, 200, deleteGroupingItems(sessionId, body.itemIds));
        } catch (error) {
          sendCaughtError(res, error, 'Could not delete items.');
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

  sendJson(res, 404, {
    status: 'not_found'
  });
});

const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMainModule) {
  const server = createBackendServer();

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[backend] port ${port} is already in use. Stop the existing backend process or change MEDIA_ORGANIZER_PORT.`);
      process.exit(1);
    }

    console.error('[backend] failed to start:', error);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`[backend] running at http://localhost:${port}`);
  });
}
