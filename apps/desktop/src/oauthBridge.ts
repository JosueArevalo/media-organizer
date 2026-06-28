import http, { type Server } from 'node:http';

const CALLBACK_PATH = '/api/export/google-photos/oauth/callback';

export class OAuthCallbackBridge {
  private server: Server | null = null;
  private timeout: NodeJS.Timeout | null = null;

  constructor(private readonly getBackend: () => { port: number; token: string }) {}

  async start() {
    if (this.server?.listening) return;

    const server = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url ?? '/', 'http://localhost:4000');
      if (requestUrl.pathname !== CALLBACK_PATH || req.method !== 'GET') {
        res.writeHead(404).end();
        return;
      }

      try {
        const backend = this.getBackend();
        const response = await fetch(`http://127.0.0.1:${backend.port}${requestUrl.pathname}${requestUrl.search}`, {
          headers: { 'X-Media-Organizer-Token': backend.token }
        });
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(error instanceof Error ? error.message : 'OAuth callback failed.');
      } finally {
        this.stop();
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(4000, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.server = server;
    this.timeout = setTimeout(() => this.stop(), 10 * 60 * 1000);
    this.timeout.unref();
  }

  stop() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.server?.close();
    this.server = null;
  }
}
