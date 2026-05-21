const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = 'RequestBodyTooLargeError';
  }
}

export const isAllowedLocalOrigin = (origin: string | undefined) => {
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return LOCAL_HOSTNAMES.has(originUrl.hostname);
  } catch {
    return false;
  }
};

export const isAllowedLocalHost = (host: string | undefined) => {
  if (!host) {
    return true;
  }

  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOCAL_HOSTNAMES.has(hostname);
};

export const getCorsHeaders = (origin: string | undefined) => {
  const allowedOrigin = isAllowedLocalOrigin(origin) && origin ? origin : 'http://localhost:5173';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    Vary: 'Origin'
  };
};

export const hasDestructiveConfirmation = (body: unknown, expectedConfirmation: string) => {
  return (
    body !== null &&
    typeof body === 'object' &&
    'confirmation' in body &&
    (body as { confirmation?: unknown }).confirmation === expectedConfirmation
  );
};
