import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { normalizeWebAssetPath } from './pathSecurity.js';

const APP_HOST = 'app';
const CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const withSecurityHeaders = async (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export const registerAppProtocol = (input: {
  webRoot: string;
  backendPort: number;
  token: string;
  beforeOAuthStart: () => Promise<void>;
}) => {
  protocol.handle('media-organizer', async (request) => {
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

      const headers = new Headers(request.headers);
      headers.set('X-Media-Organizer-Token', input.token);
      headers.delete('origin');
      const target = `http://127.0.0.1:${input.backendPort}${url.pathname}${url.search}`;
      return net.fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        bypassCustomProtocolHandlers: true
      });
    }

    let assetPath = normalizeWebAssetPath(input.webRoot, url.pathname);
    if (!assetPath) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!fs.existsSync(assetPath) || fs.statSync(assetPath).isDirectory()) {
      assetPath = path.join(input.webRoot, 'index.html');
    }

    return withSecurityHeaders(await net.fetch(pathToFileURL(assetPath).href));
  });
};

export const unregisterAppProtocol = () => {
  void protocol.unhandle('media-organizer');
};
