import fs from 'node:fs';
import path from 'node:path';
import { net, protocol } from 'electron';
import { createBackendProxyRequestInit, resolveBackendProxyTarget } from './backendProxy.js';
import { createDesktopMediaResponse, resolveDesktopMediaDescriptorTarget, type DesktopMediaDescriptor } from './desktopMedia.js';
import { normalizeWebAssetPath } from './pathSecurity.js';

const APP_HOST = 'app';
const CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const getContentType = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.ico') return 'image/x-icon';
  if (extension === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
};

const createAssetResponse = (filePath: string) => {
  const headers = new Headers({ 'Content-Type': getContentType(filePath) });
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(new Uint8Array(fs.readFileSync(filePath)), { status: 200, headers });
};

export const registerAppProtocol = (input: {
  webRoot: string;
  getBackendPort: () => number | null;
  token: string;
  beforeOAuthStart: () => Promise<void>;
  onError?: (error: unknown) => void;
}) => {
  protocol.handle('media-organizer', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== APP_HOST) {
        return new Response('Not found', { status: 404 });
      }

      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/export/google-photos/oauth/start' && request.method === 'POST') {
          try {
            await input.beforeOAuthStart();
          } catch (error) {
            return Response.json({
              status: 'oauth_callback_unavailable',
              message: `Google Photos sign-in needs local port 4000, but it could not be opened: ${error instanceof Error ? error.message : String(error)}`
            }, { status: 409 });
          }
        }

        const target = resolveBackendProxyTarget(input.getBackendPort(), url);
        if (target === null) {
          return Response.json({
            status: 'backend_offline',
            message: 'The local backend is not running. Use the recovery controls to restart it.'
          }, { status: 503 });
        }
        try {
          const backendPort = input.getBackendPort();
          const descriptorTarget = backendPort === null ? null : resolveDesktopMediaDescriptorTarget(backendPort, url);
          if (descriptorTarget) {
            try {
              const descriptorResponse = await net.fetch(descriptorTarget, {
                headers: { 'X-Media-Organizer-Token': input.token },
                bypassCustomProtocolHandlers: true
              });
              if (!descriptorResponse.ok) {
                return Response.json({ status: 'media_unavailable' }, { status: descriptorResponse.status });
              }
              const descriptor = await descriptorResponse.json() as DesktopMediaDescriptor;
              return createDesktopMediaResponse(request, descriptor);
            } catch (error) {
              input.onError?.(new Error(
                `Media protocol request ${request.method} ${url.pathname} failed: ${error instanceof Error ? error.message : String(error)}`
              ));
              return Response.json({ status: 'media_unavailable' }, { status: 502 });
            }
          }
          const init = await createBackendProxyRequestInit(request, input.token);
          return await net.fetch(target, {
            ...init,
            bypassCustomProtocolHandlers: true
          });
        } catch (error) {
          input.onError?.(error);
          return Response.json({
            status: 'backend_proxy_error',
            message: `The desktop app could not reach its local backend: ${error instanceof Error ? error.message : String(error)}`
          }, { status: 502 });
        }
      }

      let assetPath = normalizeWebAssetPath(input.webRoot, url.pathname);
      if (!assetPath) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(assetPath) || fs.statSync(assetPath).isDirectory()) {
        assetPath = path.join(input.webRoot, 'index.html');
      }

      return createAssetResponse(assetPath);
    } catch (error) {
      input.onError?.(error);
      return new Response(error instanceof Error ? error.message : String(error), {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  });
};

export const unregisterAppProtocol = () => {
  if (protocol.isProtocolHandled('media-organizer')) {
    protocol.unhandle('media-organizer');
  }
};
