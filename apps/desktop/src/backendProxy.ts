type ProxyableRequest = Pick<Request, 'method' | 'headers' | 'arrayBuffer'>;

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

export const resolveBackendProxyTarget = (backendPort: number | null, url: URL) =>
  backendPort === null ? null : `http://127.0.0.1:${backendPort}${url.pathname}${url.search}`;

export const createBackendProxyRequestInit = async (
  request: ProxyableRequest,
  token: string
): Promise<RequestInit> => {
  const method = request.method.toUpperCase();
  const headers = new Headers(request.headers);
  headers.set('X-Media-Organizer-Token', token);
  headers.delete('origin');
  headers.delete('content-length');

  let body: Uint8Array<ArrayBuffer> | undefined;
  if (!BODYLESS_METHODS.has(method)) {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > 0) {
      body = new Uint8Array(buffer);
    }
  }

  return { method, headers, body };
};
