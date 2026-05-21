import { deleteExecutionHistory, getDashboardSummary, listExecutionHistory } from './dashboard.service.js';
import { sendEmpty, sendJson } from '../http/httpResponses.js';
import type { RouteHandler } from '../http/routeTypes.js';

export const handleDashboardRoutes: RouteHandler = ({ req, res, requestUrl }) => {
  if (requestUrl.pathname === '/api/dashboard/summary' && req.method === 'GET') {
    sendJson(res, 200, getDashboardSummary());
    return true;
  }

  if (requestUrl.pathname === '/api/dashboard/executions' && req.method === 'GET') {
    sendJson(res, 200, { executions: listExecutionHistory() });
    return true;
  }

  if (requestUrl.pathname.startsWith('/api/dashboard/executions/') && req.method === 'DELETE') {
    const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
    const executionId = pathSegments[3];

    if (!executionId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return true;
    }

    if (!deleteExecutionHistory(executionId)) {
      sendJson(res, 404, { status: 'not_found' });
      return true;
    }

    sendEmpty(res, 204);
    return true;
  }

  return false;
};
