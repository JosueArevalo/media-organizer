import { readRequestJson, sendCaughtError, sendJson } from '../../http/httpResponses.js';
import type { RouteHandler } from '../../http/routeTypes.js';
import { executeExportJob } from './exportJob.runner.js';
import {
  createExportJob,
  getExportJob,
  getExportProgress,
  markExportJobFailed,
  pauseExportJob,
  retryFailedExportItems,
  testExportTarget
} from './exportJob.service.js';
import type { ExportJobRequest, ExportTargetTestRequest } from './export.types.js';

export const handleExportRoutes: RouteHandler = ({ req, res, requestUrl }) => {
  if (requestUrl.pathname === '/api/export/jobs' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as ExportJobRequest | null;

        if (!body?.sourceRoot || !body.target) {
          sendJson(res, 400, { status: 'invalid_request', message: 'sourceRoot and target are required.' });
          return;
        }

        if (body.target.type === 'network-folder' && !body.target.destinationPath) {
          sendJson(res, 400, { status: 'invalid_request', message: 'target.destinationPath is required.' });
          return;
        }

        sendJson(res, 201, createExportJob(body));
      } catch (error) {
        sendCaughtError(res, error, 'Failed to create export job.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/export/targets/test' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as ExportTargetTestRequest | null;

        if (!body?.target) {
          sendJson(res, 400, { status: 'invalid_request', message: 'target is required.' });
          return;
        }

        sendJson(res, 200, testExportTarget(body.target));
      } catch (error) {
        sendCaughtError(res, error, 'Failed to test export target.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname.startsWith('/api/export/jobs/')) {
    const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
    const jobId = pathSegments[3];
    const subPath = pathSegments[4];

    if (!jobId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return true;
    }

    if (req.method === 'GET' && subPath === 'progress') {
      const progress = getExportProgress(jobId);

      if (!progress) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      sendJson(res, 200, progress);
      return true;
    }

    if (req.method === 'GET' && !subPath) {
      const job = getExportJob(jobId);

      if (!job) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      sendJson(res, 200, job);
      return true;
    }

    if (req.method === 'POST' && subPath === 'start') {
      const job = getExportJob(jobId);

      if (!job) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      void executeExportJob(jobId).catch((error) => {
        console.error(`[backend] export job ${jobId} failed`, error);
        markExportJobFailed(jobId, error instanceof Error ? error : new Error('Export job failed.'));
      });

      sendJson(res, 202, getExportJob(jobId));
      return true;
    }

    if (req.method === 'POST' && subPath === 'pause') {
      const job = pauseExportJob(jobId);

      if (!job) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      sendJson(res, 200, job);
      return true;
    }

    if (req.method === 'POST' && subPath === 'retry-failed') {
      const job = retryFailedExportItems(jobId);

      if (!job) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      void executeExportJob(jobId).catch((error) => {
        console.error(`[backend] export job ${jobId} retry failed`, error);
        markExportJobFailed(jobId, error instanceof Error ? error : new Error('Export job retry failed.'));
      });

      sendJson(res, 202, getExportJob(jobId));
      return true;
    }
  }

  return false;
};
