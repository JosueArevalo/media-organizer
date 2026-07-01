import { readRequestJson, sendCaughtError, sendJson } from '../../http/httpResponses.js';
import type { RouteHandler } from '../../http/routeTypes.js';
import { validateImportFolders } from './importValidation.service.js';

export const handleImportValidationRoutes: RouteHandler = ({ req, res, requestUrl }) => {
  if (requestUrl.pathname !== '/api/import/validate-folders' || req.method !== 'POST') {
    return false;
  }

  void (async () => {
    try {
      const body = (await readRequestJson(req)) as { sourcePath?: unknown; destinationPath?: unknown } | null;
      const sourcePath = typeof body?.sourcePath === 'string' ? body.sourcePath : '';
      const destinationPath = typeof body?.destinationPath === 'string' ? body.destinationPath : '';

      if (!sourcePath.trim() || !destinationPath.trim()) {
        sendJson(res, 400, {
          status: 'invalid_request',
          message: 'sourcePath and destinationPath are required.'
        });
        return;
      }

      sendJson(res, 200, await validateImportFolders(sourcePath, destinationPath));
    } catch (error) {
      sendCaughtError(res, error, 'Could not validate import folders.');
    }
  })();

  return true;
};
