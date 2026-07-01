import { sendCaughtError, sendJson, readRequestJson } from '../../http/httpResponses.js';
import type { RouteHandler } from '../../http/routeTypes.js';
import { scanSourceTreeByPath } from './sourceTreeScan.service.js';

export const handleSourceTreeRoutes: RouteHandler = ({ req, res, requestUrl }) => {
  if (requestUrl.pathname !== '/api/source-tree/scan' || req.method !== 'POST') {
    return false;
  }

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
      sendCaughtError(res, error, 'Could not scan source path.');
    }
  })();

  return true;
};
