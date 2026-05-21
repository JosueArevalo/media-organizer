import path from 'node:path';
import { readdir, rm, stat } from 'node:fs/promises';
import { getDb } from '../state/db.js';
import { resolveToolCommand } from '../pipeline/compression/toolCommandResolver.js';
import { listHandBrakePresets } from '../pipeline/compression/handbrakePresets.service.js';
import { hasDestructiveConfirmation } from '../http/localAccess.js';
import { readRequestJson, sendCaughtError, sendJson } from '../http/httpResponses.js';
import type { RouteHandler } from '../http/routeTypes.js';
import { validateClearDestinationRequest } from './maintenance.service.js';
import { isAllowedPickerOrigin, pickDirectory, pickFile, type SystemPickerFilter } from './systemPicker.service.js';

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

const sendPickerResult = (res: Parameters<RouteHandler>[0]['res'], result: Awaited<ReturnType<typeof pickDirectory>>) => {
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

export const handleSystemRoutes: RouteHandler = ({ req, res, requestUrl }) => {
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
        sendCaughtError(res, error, 'Could not open folder picker.');
      }
    })();

    return true;
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
        sendCaughtError(res, error, 'Could not open file picker.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/system/maintenance/clear-destination' && req.method === 'POST') {
    void (async () => {
      try {
        const validation = validateClearDestinationRequest(await readRequestJson(req));

        if (!validation.valid) {
          sendJson(res, 400, validation);
          return;
        }

        const destinationStats = await stat(validation.destinationResolved).catch(() => null);

        if (!destinationStats || !destinationStats.isDirectory()) {
          sendJson(res, 400, {
            status: 'invalid_request',
            message: 'Destination path was not found or is not a directory.'
          });
          return;
        }

        const deletedEntries = await clearDirectoryContents(validation.destinationResolved);

        sendJson(res, 200, {
          status: 'ok',
          destinationPath: validation.destinationResolved,
          deletedEntries
        });
      } catch (error) {
        sendCaughtError(res, error, 'Could not clear destination folder.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/system/maintenance/reset-persistent-state' && req.method === 'POST') {
    void (async () => {
      try {
        const body = await readRequestJson(req);

        if (!hasDestructiveConfirmation(body, 'RESET_STATE')) {
          sendJson(res, 400, {
            status: 'invalid_request',
            message: 'confirmation must be RESET_STATE.'
          });
          return;
        }

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
        sendCaughtError(res, error, 'Could not reset backend persistent state.');
      }
    })();

    return true;
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
        sendCaughtError(res, error, 'Could not resolve command path.');
      }
    })();

    return true;
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
        sendCaughtError(res, error, 'Could not load HandBrake presets.');
      }
    })();

    return true;
  }

  return false;
};
