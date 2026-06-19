import { sendCaughtError, sendJson, readRequestJson } from '../../http/httpResponses.js';
import type { RouteHandler } from '../../http/routeTypes.js';
import {
  getCompressionProgress,
  getCompressionSession,
  getActiveCompressionSession,
  markCompressionSessionFailed,
  pauseCompressionSession,
  startCompressionSessionResume,
  startCompressionSession,
  CompressionToolConfigurationError,
  type CompressionProcessingPolicy
} from './compressionJob.service.js';
import { executeCompressionSession } from './compressionJob.runner.js';

export const handleCompressionRoutes: RouteHandler = ({ req, res, requestUrl }) => {
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
              videoOutputFormatMode?: 'preserve' | 'mp4';
              imageToolCommand?: string;
              videoToolCommand?: string;
              imageMagickCommand?: string;
              exifToolCommand?: string;
              processingPolicy?: Partial<CompressionProcessingPolicy>;
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
          videoOutputFormatMode: body.videoOutputFormatMode,
          imageToolCommand: body.imageToolCommand,
          videoToolCommand: body.videoToolCommand,
          imageMagickCommand: body.imageMagickCommand,
          exifToolCommand: body.exifToolCommand,
          processingPolicy: body.processingPolicy,
          selectionScope: body.selectionScope ?? undefined
        });

        void executeCompressionSession(result.session.id).catch((error) => {
          console.error(`[backend] compression session ${result.session.id} failed`, error);
          markCompressionSessionFailed(result.session.id, error instanceof Error ? error : new Error('Compression session failed.'));
        });

        sendJson(res, 201, result);
      } catch (error) {
        if (error instanceof CompressionToolConfigurationError) {
          sendJson(res, 400, { status: 'tool_configuration_required', message: error.message });
          return;
        }
        sendCaughtError(res, error, 'Failed to start compression session.');
      }
    })();

    return true;
  }

  if (requestUrl.pathname === '/api/compression/active-session' && req.method === 'GET') {
    sendJson(res, 200, getActiveCompressionSession());
    return true;
  }

  if (requestUrl.pathname.startsWith('/api/compression/sessions/') && (req.method === 'GET' || req.method === 'POST')) {
    const pathSegments = requestUrl.pathname.split('/').filter(Boolean);
    const sessionId = pathSegments[3];
    const subPath = pathSegments[4];

    if (!sessionId) {
      sendJson(res, 400, { status: 'invalid_request' });
      return true;
    }

    if (subPath === 'progress') {
      const progress = getCompressionProgress(sessionId);

      if (!progress) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      sendJson(res, 200, progress);
      return true;
    }

    if (req.method === 'POST' && subPath === 'resume') {
      const session = startCompressionSessionResume(sessionId);

      if (!session) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      void executeCompressionSession(sessionId).catch((error) => {
        console.error(`[backend] compression session ${sessionId} resume failed`, error);
        markCompressionSessionFailed(sessionId, error instanceof Error ? error : new Error('Compression session resume failed.'));
      });

      sendJson(res, 202, session);
      return true;
    }

    if (req.method === 'POST' && subPath === 'pause') {
      const session = pauseCompressionSession(sessionId);

      if (!session) {
        sendJson(res, 404, { status: 'not_found' });
        return true;
      }

      sendJson(res, 202, session);
      return true;
    }

    if (req.method !== 'GET') {
      sendJson(res, 404, { status: 'not_found' });
      return true;
    }

    const session = getCompressionSession(sessionId);

    if (!session) {
      sendJson(res, 404, { status: 'not_found' });
      return true;
    }

    sendJson(res, 200, session);
    return true;
  }

  return false;
};
