import { readRequestJson, sendCaughtError, sendJson } from '../../http/httpResponses.js';
import type { RouteHandler } from '../../http/routeTypes.js';
import { assertNetworkExportRunnerAvailable, executeExportJob } from './exportJob.runner.js';
import {
  assertExportJobCanStart,
  createExportJob,
  getExportJob,
  getExportProgress,
  listExportJobs,
  markExportJobFailed,
  pauseExportJob,
  previewGooglePhotosExport,
  retryExportItem,
  retryFailedExportItems,
  testExportTarget
} from './exportJob.service.js';
import {
  completeGooglePhotosOAuth,
  deleteGooglePhotosOAuthConfig,
  deleteGooglePhotosAccount,
  GooglePhotosOAuthNotConfiguredError,
  getGooglePhotosOAuthConfigStatus,
  listGooglePhotosAccounts,
  saveGooglePhotosOAuthConfig,
  startGooglePhotosOAuth
} from './googlePhotosAuth.service.js';
import {
  authenticateNetworkPath,
  browseNetworkPath,
  createNetworkFolder,
  deleteNetworkDestination,
  listNetworkDestinations,
  NetworkPathError,
  saveNetworkDestination
} from './networkDestination.service.js';
import type {
  ExportJobRequest,
  GooglePhotosOAuthConfigRequest,
  ExportTargetTestRequest,
  NetworkAuthRequest,
  NetworkBrowseRequest,
  NetworkCreateFolderRequest,
  NetworkDestinationRequest
} from './export.types.js';
import { listExportProviderSummaries } from './exportSummary.service.js';

const sendExportRouteError = (res: Parameters<RouteHandler>[0]['res'], error: unknown, fallbackMessage: string) => {
  if (error instanceof NetworkPathError) {
    sendJson(res, 400, { status: 'invalid_network_path', message: error.message });
    return;
  }

  sendCaughtError(res, error, fallbackMessage);
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const handleExportRoutes: RouteHandler = ({ req, res, requestUrl }) => {
  if (requestUrl.pathname === '/api/export/summaries' && req.method === 'GET') {
    sendJson(res, 200, {
      summaries: listExportProviderSummaries({
        executionId: requestUrl.searchParams.get('executionId'),
        groupingSessionId: requestUrl.searchParams.get('groupingSessionId'),
        sourceRoot: requestUrl.searchParams.get('sourceRoot')
      })
    });
    return true;
  }

  if (requestUrl.pathname === '/api/export/google-photos/config' && req.method === 'GET') {
    sendJson(res, 200, getGooglePhotosOAuthConfigStatus());
    return true;
  }

  if (requestUrl.pathname === '/api/export/google-photos/config' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as GooglePhotosOAuthConfigRequest | null;

        if (!body?.clientId?.trim()) {
          sendJson(res, 400, { status: 'invalid_request', message: 'clientId is required.' });
          return;
        }

        sendJson(res, 200, saveGooglePhotosOAuthConfig(body));
      } catch (error) {
        sendCaughtError(res, error, 'Failed to save Google Photos OAuth configuration.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/export/google-photos/config' && req.method === 'DELETE') {
    sendJson(res, 200, deleteGooglePhotosOAuthConfig());
    return true;
  }

  if (requestUrl.pathname === '/api/export/google-photos/accounts' && req.method === 'GET') {
    sendJson(res, 200, { accounts: listGooglePhotosAccounts() });
    return true;
  }

  if (requestUrl.pathname === '/api/export/google-photos/oauth/start' && req.method === 'POST') {
    try {
      sendJson(res, 200, startGooglePhotosOAuth());
    } catch (error) {
      if (error instanceof GooglePhotosOAuthNotConfiguredError) {
        sendJson(res, 400, { status: 'google_photos_oauth_not_configured', message: error.message });
        return true;
      }

      sendCaughtError(res, error, 'Failed to start Google Photos OAuth.');
    }

    return true;
  }

  if (requestUrl.pathname === '/api/export/google-photos/oauth/callback' && req.method === 'GET') {
    void (async () => {
      try {
        const code = requestUrl.searchParams.get('code');
        const state = requestUrl.searchParams.get('state');

        if (!code || !state) {
          sendJson(res, 400, { status: 'invalid_request', message: 'code and state are required.' });
          return;
        }

        const account = await completeGooglePhotosOAuth(code, state);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><html><body><p>Google Photos connected for ${escapeHtml(account.email)}. You can close this tab.</p></body></html>`
        );
      } catch (error) {
        sendCaughtError(res, error, 'Failed to complete Google Photos OAuth.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/export/google-photos/preview' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as { accountId?: string; sourceRoot?: string } | null;

        if (!body?.accountId || !body.sourceRoot) {
          sendJson(res, 400, { status: 'invalid_request', message: 'accountId and sourceRoot are required.' });
          return;
        }

        sendJson(res, 200, await previewGooglePhotosExport(body.accountId, body.sourceRoot));
      } catch (error) {
        sendCaughtError(res, error, 'Failed to preview Google Photos export.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname.startsWith('/api/export/google-photos/accounts/') && req.method === 'DELETE') {
    const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
    const accountId = pathSegments[4];

    if (!accountId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return true;
    }

    if (!deleteGooglePhotosAccount(accountId)) {
      sendJson(res, 404, { status: 'not_found' });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

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

  if (requestUrl.pathname === '/api/export/jobs' && req.method === 'GET') {
    const targetType = requestUrl.searchParams.get('targetType');

    if (targetType && targetType !== 'network-folder' && targetType !== 'google-photos') {
      sendJson(res, 400, { status: 'invalid_request', message: 'Unsupported targetType.' });
      return true;
    }

    sendJson(res, 200, {
      jobs: listExportJobs({
        targetType: targetType as 'network-folder' | 'google-photos' | null,
        groupingSessionId: requestUrl.searchParams.get('groupingSessionId'),
        sourceRoot: requestUrl.searchParams.get('sourceRoot')
      })
    });
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

        sendJson(res, 200, await testExportTarget(body.target, body.credentials));
      } catch (error) {
        sendCaughtError(res, error, 'Failed to test export target.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/export/network-destinations' && req.method === 'GET') {
    sendJson(res, 200, { destinations: listNetworkDestinations() });
    return true;
  }

  if (requestUrl.pathname === '/api/export/network-destinations' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as NetworkDestinationRequest | null;

        if (!body?.rootPath) {
          sendJson(res, 400, { status: 'invalid_request', message: 'rootPath is required.' });
          return;
        }

        sendJson(res, 201, saveNetworkDestination(body));
      } catch (error) {
        sendExportRouteError(res, error, 'Failed to save network destination.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname.startsWith('/api/export/network-destinations/') && req.method === 'DELETE') {
    const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
    const destinationId = pathSegments[3];

    if (!destinationId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return true;
    }

    if (!deleteNetworkDestination(destinationId)) {
      sendJson(res, 404, { status: 'not_found' });
      return true;
    }

    sendJson(res, 200, { ok: true });
    return true;
  }

  if (requestUrl.pathname === '/api/export/network/auth' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as NetworkAuthRequest | null;

        if (!body?.path || !body.credentials) {
          sendJson(res, 400, { status: 'invalid_request', message: 'path and credentials are required.' });
          return;
        }

        sendJson(res, 200, await authenticateNetworkPath(body));
      } catch (error) {
        sendExportRouteError(res, error, 'Failed to authenticate network path.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/export/network/browse' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as NetworkBrowseRequest | null;

        if (!body?.path) {
          sendJson(res, 400, { status: 'invalid_request', message: 'path is required.' });
          return;
        }

        sendJson(res, 200, await browseNetworkPath(body));
      } catch (error) {
        sendExportRouteError(res, error, 'Failed to browse network path.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/export/network/create-folder' && req.method === 'POST') {
    void (async () => {
      try {
        const body = (await readRequestJson(req)) as NetworkCreateFolderRequest | null;

        if (!body?.parentPath || !body.folderName) {
          sendJson(res, 400, { status: 'invalid_request', message: 'parentPath and folderName are required.' });
          return;
        }

        sendJson(res, 201, await createNetworkFolder(body));
      } catch (error) {
        sendExportRouteError(res, error, 'Failed to create network folder.');
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
      try {
        assertExportJobCanStart(jobId);
        assertNetworkExportRunnerAvailable(jobId);
        void executeExportJob(jobId).catch((error) => {
          console.error(`[backend] export job ${jobId} failed`, error);
          markExportJobFailed(jobId, error instanceof Error ? error : new Error('Export job failed.'));
        });
        sendJson(res, 202, getExportJob(jobId));
      } catch (error) {
        sendExportRouteError(res, error, 'Failed to start export job.');
      }
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
      try {
        assertExportJobCanStart(jobId);
        assertNetworkExportRunnerAvailable(jobId);
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
      } catch (error) {
        sendExportRouteError(res, error, 'Failed to retry export job.');
      }
      return true;
    }

    if (req.method === 'POST' && subPath === 'items' && pathSegments[6] === 'retry') {
      try {
        const job = retryExportItem(jobId, pathSegments[5]);

        if (!job) {
          sendJson(res, 404, { status: 'not_found' });
          return true;
        }

        sendJson(res, 200, job);
      } catch (error) {
        sendExportRouteError(res, error, 'Failed to retry export item.');
      }

      return true;
    }
  }

  return false;
};
