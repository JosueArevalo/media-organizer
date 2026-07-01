import type { ClientRequest, IncomingMessage } from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const HEALTH_CHECK_PATH = '/api/health';
const HEALTH_CHECK_PROXY_PATH = '/health';
const HEALTH_OFFLINE_REPORT_PATH = '/api/health/offline-report';
const HEALTH_OFFLINE_REPORT_PROXY_PATH = '/health/offline-report';
const HEALTH_CHECK_SLOW_MS = 1500;
const healthRequestStartedAt = new WeakMap<IncomingMessage, number>();

const getRequestPath = (req: IncomingMessage) => req.url?.split('?')[0];

const isHealthCheckRequest = (req: IncomingMessage) => {
  const path = getRequestPath(req);

  return path === HEALTH_CHECK_PATH || path === HEALTH_CHECK_PROXY_PATH;
};

const isBackendHealthDiagnosticRequest = (req: IncomingMessage) => {
  const path = getRequestPath(req);

  return (
    path === HEALTH_CHECK_PATH ||
    path === HEALTH_CHECK_PROXY_PATH ||
    path === HEALTH_OFFLINE_REPORT_PATH ||
    path === HEALTH_OFFLINE_REPORT_PROXY_PATH
  );
};

const getElapsedMs = (req: IncomingMessage) => {
  const startedAt = healthRequestStartedAt.get(req);

  return startedAt ? Date.now() - startedAt : null;
};

const formatElapsed = (elapsedMs: number | null) => elapsedMs === null ? 'unknown duration' : `${elapsedMs}ms`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (_proxyReq: ClientRequest, req: IncomingMessage) => {
            if (isBackendHealthDiagnosticRequest(req)) {
              healthRequestStartedAt.set(req, Date.now());
            }
          });

          proxy.on('proxyRes', (proxyRes: IncomingMessage, req: IncomingMessage) => {
            if (!isHealthCheckRequest(req)) {
              return;
            }

            const elapsedMs = getElapsedMs(req);
            const statusCode = proxyRes.statusCode ?? 0;

            if (statusCode >= 400) {
              console.warn(`[backend-health] ${HEALTH_CHECK_PATH} returned HTTP ${statusCode} in ${formatElapsed(elapsedMs)}.`);
              return;
            }

            if (elapsedMs !== null && elapsedMs > HEALTH_CHECK_SLOW_MS) {
              console.warn(
                `[backend-health] ${HEALTH_CHECK_PATH} responded slowly in ${elapsedMs}ms; frontend timeout is ${HEALTH_CHECK_SLOW_MS}ms.`
              );
            }
          });

          proxy.on('error', (error: Error & { code?: string }, req: IncomingMessage) => {
            if (!isBackendHealthDiagnosticRequest(req)) {
              return;
            }

            const code = error.code ? `${error.code}: ` : '';
            console.warn(
              `[backend-health] ${getRequestPath(req) ?? 'unknown path'} proxy error after ${formatElapsed(getElapsedMs(req))}: ${code}${error.message}`
            );
          });
        }
      }
    }
  }
});
