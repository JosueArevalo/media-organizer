import { createServer } from 'node:http';
import { pathToFileURL, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './state/migrations/runMigrations.js';
import { getDbPath } from './state/db.js';
import { handleDashboardRoutes } from './dashboard/dashboard.routes.js';
import { handleCompressionRoutes } from './pipeline/compression/compression.routes.js';
import { reconcileInterruptedCompressionSessions } from './pipeline/compression/compressionJob.service.js';
import { handleExportRoutes } from './pipeline/export/export.routes.js';
import { reconcileInterruptedExportJobs } from './pipeline/export/exportJob.service.js';
import { handleImportValidationRoutes } from './pipeline/import/importValidation.routes.js';
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
  getGroupingBaselineMigrationStatus,
  getGroupingMediaPath,
  getGroupingPreviewPath,
  getGroupingThumbnailPath,
  getGroupingWorkspace,
  GroupingPreviewError,
  listGroupingTemplates,
  reorganizeGroupingWorkspace,
  renameGroupingFolder,
  renamePreservedGroupingFolderScope,
  resetGroupingWorkspace,
  startGroupingBaselineMigration,
  trashGroupingItems,
  updateGroupingTemplate
} from './pipeline/grouping/groupingWorkspace.service.js';
import { handleSourceTreeRoutes } from './pipeline/source/sourceTree.routes.js';
import { handleSystemRoutes } from './system/system.routes.js';
import {
  getCorsHeaders,
  isAllowedLocalHost,
  isAllowedLocalOrigin,
  isDesktopRequestAuthorized
} from './http/localAccess.js';
import { readRequestJson, sendCaughtError, sendEmpty, sendJson } from './http/httpResponses.js';
import { getRuntimeInfo } from './runtime/runtimeInfo.js';
import { beginGroupingMediaOperation } from './pipeline/grouping/groupingMediaDiagnostics.js';

const port = Number(process.env.PORT ?? 4000);
const BACKEND_HEALTH_OFFLINE_REPORT_PATH = '/api/health/offline-report';
const MAX_RECENT_HEALTH_PROBES = 8;
const VIDEO_POSTER_RANGE_BYTES = 12 * 1024 * 1024;

type BackendHealthOfflineReport = {
  previousStatus?: string;
  status?: string;
  failureKind?: string | null;
  errorMessage?: string | null;
  consecutiveFailures?: number;
  consecutiveSuccesses?: number;
  lastCheckedAt?: number | null;
  lastOkAt?: number | null;
  msSinceLastOk?: number | null;
  timeoutMs?: number | null;
  healthUrl?: string | null;
};

type HealthProbeTrace = {
  id: number;
  startedAt: number;
  durationMs: number | null;
  statusCode: number | null;
  outcome: 'ok' | 'client_closed';
};

const recentHealthProbes: HealthProbeTrace[] = [];
let nextHealthProbeId = 1;

const formatTimestamp = (timestamp: number | null | undefined) => {
  if (typeof timestamp !== 'number') {
    return 'never';
  }

  return new Date(timestamp).toISOString();
};

const formatOptionalMs = (duration: number | null | undefined) => {
  if (typeof duration !== 'number') {
    return 'unknown';
  }

  return `${duration}ms`;
};

const pushHealthProbeTrace = (trace: HealthProbeTrace) => {
  recentHealthProbes.push(trace);

  while (recentHealthProbes.length > MAX_RECENT_HEALTH_PROBES) {
    recentHealthProbes.shift();
  }
};

const formatRecentHealthProbes = () => {
  if (recentHealthProbes.length === 0) {
    return 'none';
  }

  return recentHealthProbes
    .map((probe) => {
      const ageMs = Date.now() - probe.startedAt;
      const duration = probe.durationMs === null ? '?' : `${probe.durationMs}ms`;
      const status = probe.statusCode ?? '?';

      return `#${probe.id}:${probe.outcome}/${status}/${duration}/${ageMs}ms-ago`;
    })
    .join(',');
};

const logBackendHealthOfflineReport = (report: BackendHealthOfflineReport) => {
  console.warn(
    [
      '[backend-health] offline',
      `prev=${report.previousStatus ?? 'unknown'}`,
      `kind=${report.failureKind ?? 'unknown'}`,
      `fails=${report.consecutiveFailures ?? 'unknown'}`,
      `lastCheck=${formatTimestamp(report.lastCheckedAt)}`,
      `lastOk=${formatTimestamp(report.lastOkAt)}`,
      `sinceOk=${formatOptionalMs(report.msSinceLastOk)}`,
      `timeout=${formatOptionalMs(report.timeoutMs)}`,
      `url=${report.healthUrl ?? 'unknown'}`,
      `recent=${formatRecentHealthProbes()}`,
      `err=${report.errorMessage ?? 'none'}`
    ].join(' | ')
  );
};

const trackHealthProbe = (res: import('node:http').ServerResponse) => {
  const id = nextHealthProbeId;
  nextHealthProbeId += 1;

  const startedAt = Date.now();
  let finished = false;

  res.on('finish', () => {
    finished = true;
    pushHealthProbeTrace({
      id,
      startedAt,
      durationMs: Date.now() - startedAt,
      statusCode: res.statusCode,
      outcome: 'ok'
    });
  });

  res.on('close', () => {
    if (finished) {
      return;
    }

    pushHealthProbeTrace({
      id,
      startedAt,
      durationMs: Date.now() - startedAt,
      statusCode: res.statusCode || null,
      outcome: 'client_closed'
    });
  });
};

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

type MediaByteRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

const parseMediaByteRange = (value: string | undefined, size: number): MediaByteRange => {
  if (!value) return { kind: 'full' };
  if (size === 0) return { kind: 'unsatisfiable' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return { kind: 'unsatisfiable' };

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'unsatisfiable' };
    return {
      kind: 'partial',
      start: Math.max(0, size - suffixLength),
      end: size - 1
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) {
    return { kind: 'unsatisfiable' };
  }

  return { kind: 'partial', start, end: Math.min(requestedEnd, size - 1) };
};

const streamMediaFile = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  filePath: string,
  cacheControl = 'private, max-age=3600',
  options: { limitOpenEndedVideoRange?: boolean } = {}
) => {
  const stats = fs.statSync(filePath);
  const contentType = getMediaContentType(filePath);
  const isVideo = contentType.startsWith('video/');
  const range = parseMediaByteRange(req.method === 'HEAD' ? undefined : req.headers.range, stats.size);
  const headersBase: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'Last-Modified': stats.mtime.toUTCString(),
    'Content-Type': contentType
  };
  const pipeStream = (stream: fs.ReadStream) => {
    const destroyStream = () => stream.destroy();
    req.once('aborted', destroyStream);
    res.once('close', destroyStream);
    stream.once('close', () => {
      req.removeListener('aborted', destroyStream);
      res.removeListener('close', destroyStream);
    });
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Could not stream media file.' }));
        return;
      }

      res.destroy();
    });
    stream.pipe(res);
  };

  if (
    range.kind === 'full'
    && req.method !== 'HEAD'
    && isVideo
    && stats.size > 0
    && options.limitOpenEndedVideoRange
  ) {
    const end = Math.min(stats.size - 1, VIDEO_POSTER_RANGE_BYTES - 1);
    res.writeHead(206, {
      ...headersBase,
      'Content-Length': end + 1,
      'Content-Range': `bytes 0-${end}/${stats.size}`
    });
    pipeStream(fs.createReadStream(filePath, { start: 0, end }));
    return;
  }

  if (range.kind === 'unsatisfiable') {
    res.writeHead(416, {
      ...headersBase,
      'Content-Length': '0',
      'Content-Range': `bytes */${stats.size}`
    });
    res.end();
    return;
  }

  if (range.kind === 'full') {
    res.writeHead(200, {
      ...headersBase,
      'Content-Length': stats.size
    });
    if (req.method === 'HEAD' || stats.size === 0) {
      res.end();
      return;
    }
    pipeStream(fs.createReadStream(filePath));
    return;
  }

  res.writeHead(206, {
    ...headersBase,
    'Content-Length': range.end - range.start + 1,
    'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`
  });
  pipeStream(fs.createReadStream(filePath, { start: range.start, end: range.end }));
};

const traceGroupingMediaRequest = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  operation: 'media' | 'poster' | 'preview' | 'thumbnail',
  sessionId: string,
  itemId: string
) => {
  const item = getGroupingWorkspace(sessionId)?.items.find((candidate) => candidate.id === itemId);
  const trace = beginGroupingMediaOperation({
    operation,
    sessionId,
    itemId,
    fileName: item?.fileName ?? 'unknown'
  });
  req.once('aborted', () => trace.finish('aborted'));
  res.once('finish', () => trace.finish('completed'));
  res.once('close', () => {
    if (!res.writableFinished) trace.finish('aborted');
  });
  return trace;
};

export const createBackendServer = (appliedMigrations = runMigrations()) => {
  reconcileInterruptedCompressionSessions();
  reconcileInterruptedExportJobs();

  return createServer(async (req, res) => {
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

  if (!isDesktopRequestAuthorized(req.headers['x-media-organizer-token'])) {
    sendJson(res, 401, { status: 'unauthorized' });
    return;
  }

  for (const [header, value] of Object.entries(getCorsHeaders(req.headers.origin))) {
    res.setHeader(header, value);
  }

  const internalMediaMatch = requestUrl.pathname.match(/^\/internal\/grouping\/([^/]+)\/items\/([^/]+)\/media-path$/);
  if (internalMediaMatch && req.method === 'GET') {
    if (!process.env.MEDIA_ORGANIZER_DESKTOP_TOKEN) {
      sendJson(res, 404, { status: 'not_found' });
      return;
    }
    const media = getGroupingMediaPath(decodeURIComponent(internalMediaMatch[1]), decodeURIComponent(internalMediaMatch[2]));
    if (!media || !fs.existsSync(media.path)) {
      sendJson(res, 404, { status: 'not_found' });
      return;
    }
    sendJson(res, 200, { path: media.path, contentType: getMediaContentType(media.path) });
    return;
  }

  if (requestUrl.pathname === BACKEND_HEALTH_OFFLINE_REPORT_PATH && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as BackendHealthOfflineReport | null;
        logBackendHealthOfflineReport(body ?? {});
        sendJson(res, 200, { status: 'ok' });
      } catch (error) {
        sendCaughtError(res, error, 'Could not record backend health diagnostic.');
      }
    })();

    return;
  }

  if (requestUrl.pathname === '/api/health' && req.method === 'GET') {
    trackHealthProbe(res);
    sendJson(res, 200, {
      status: 'ok',
      service: 'backend',
      time: new Date().toISOString(),
      dbPath: getDbPath(),
      appliedMigrations
    });
    return;
  }


  if (requestUrl.pathname === '/api/system/runtime' && req.method === 'GET') {
    sendJson(res, 200, getRuntimeInfo());
    return;
  }

  if (
    handleDashboardRoutes({ req, res, requestUrl }) ||
    handleCompressionRoutes({ req, res, requestUrl }) ||
    handleExportRoutes({ req, res, requestUrl }) ||
    handleImportValidationRoutes({ req, res, requestUrl }) ||
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

  if (requestUrl.pathname.startsWith('/api/grouping/') && ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method ?? '')) {
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

    if (req.method === 'POST' && subPath === 'legacy-baselines' && subId === 'migrate') {
      try {
        sendJson(res, 202, startGroupingBaselineMigration(sessionId));
      } catch (error) {
        sendCaughtError(res, error, 'Could not start legacy baseline migration.');
      }
      return;
    }

    if (req.method === 'GET' && subPath === 'legacy-baselines' && subId === 'migration') {
      sendJson(res, 200, getGroupingBaselineMigrationStatus(sessionId));
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
          const body = (await readRequestJson(req)) as {
            itemIds?: string[];
            targetGroupLabel?: string;
            targetPreservedScopePath?: string;
          } | null;

          if (
            !Array.isArray(body?.itemIds)
            || typeof body.targetGroupLabel !== 'string'
            || !body.targetGroupLabel
            || (body.targetPreservedScopePath !== undefined && typeof body.targetPreservedScopePath !== 'string')
          ) {
            sendJson(res, 400, { status: 'invalid_request', message: 'itemIds and targetGroupLabel are required.' });
            return;
          }

          sendJson(
            res,
            200,
            assignGroupingItems(sessionId, body.itemIds, body.targetGroupLabel, body.targetPreservedScopePath)
          );
        } catch (error) {
          sendCaughtError(res, error, 'Could not assign items.');
        }
      })();

      return;
    }

    if (req.method === 'POST' && subPath === 'preserved-folders' && subId === 'rename') {
      void (async () => {
        try {
          const body = (await readRequestJson(req)) as { scopePath?: string; label?: string } | null;

          if (!body?.scopePath || !body.label) {
            sendJson(res, 400, { status: 'invalid_request', message: 'scopePath and label are required.' });
            return;
          }

          const workspace = renamePreservedGroupingFolderScope(sessionId, body.scopePath, body.label);

          if (!workspace) {
            sendJson(res, 404, { status: 'not_found' });
            return;
          }

          sendJson(res, 200, workspace);
        } catch (error) {
          sendCaughtError(res, error, 'Could not rename preserved folder.');
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

    if (req.method === 'POST' && subPath === 'items' && subId === 'trash') {
      void (async () => {
        try {
          const body = (await readRequestJson(req)) as { itemIds?: string[] } | null;

          if (!Array.isArray(body?.itemIds)) {
            sendJson(res, 400, { status: 'invalid_request', message: 'itemIds is required.' });
            return;
          }

          sendJson(res, 200, trashGroupingItems(sessionId, body.itemIds));
        } catch (error) {
          sendCaughtError(res, error, 'Could not move items to grouping trash.');
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

    if (req.method === 'POST' && subPath === 'reset') {
      try {
        const result = resetGroupingWorkspace(sessionId);

        if (!result) {
          sendJson(res, 404, { status: 'not_found' });
          return;
        }

        sendJson(res, result.status === 'partial_failed' ? 207 : 200, result);
      } catch (error) {
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not reset grouping workspace.'
        });
      }

      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && subPath === 'items' && subId && tailPath === 'media') {
      const usage = requestUrl.searchParams.get('usage');
      const operation = usage === 'poster' ? 'poster' : 'media';
      const trace = traceGroupingMediaRequest(req, res, operation, sessionId, subId);
      try {
        const media = getGroupingMediaPath(sessionId, subId);

        if (!media || !fs.existsSync(media.path)) {
          sendJson(res, 404, { status: 'not_found' });
          return;
        }

        streamMediaFile(req, res, media.path, 'no-store', {
          limitOpenEndedVideoRange: usage === 'poster'
        });
      } catch (error) {
        trace.finish('failed', error);
        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not stream media.'
        });
      }

      return;
    }

    if (req.method === 'GET' && subPath === 'items' && subId && tailPath === 'preview') {
      const trace = traceGroupingMediaRequest(req, res, 'preview', sessionId, subId);
      try {
        const media = await getGroupingPreviewPath(sessionId, subId);

        if (!media || !fs.existsSync(media.path)) {
          sendJson(res, 404, { status: 'not_found' });
          return;
        }

        streamMediaFile(req, res, media.path);
      } catch (error) {
        trace.finish('failed', error);
        if (error instanceof GroupingPreviewError) {
          sendJson(res, 422, {
            status: 'preview_unavailable',
            message: error.message
          });
          return;
        }

        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not stream media preview.'
        });
      }

      return;
    }

    if (req.method === 'GET' && subPath === 'items' && subId && tailPath === 'thumbnail') {
      const trace = traceGroupingMediaRequest(req, res, 'thumbnail', sessionId, subId);
      try {
        const media = await getGroupingThumbnailPath(sessionId, subId);

        if (!media || !fs.existsSync(media.path)) {
          sendJson(res, 404, { status: 'not_found' });
          return;
        }

        streamMediaFile(req, res, media.path, 'private, max-age=86400');
      } catch (error) {
        trace.finish('failed', error);
        if (error instanceof GroupingPreviewError) {
          sendJson(res, 422, {
            status: 'preview_unavailable',
            message: error.message
          });
          return;
        }

        sendJson(res, 500, {
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not stream media thumbnail.'
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
};

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

  server.listen(port, '127.0.0.1', () => {
    console.log(`[backend] running at http://localhost:${port}`);
  });
}
