import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_JSON_BODY_BYTES, RequestBodyTooLargeError } from './localAccess.js';

export const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
};

export const sendEmpty = (res: ServerResponse, status: number) => {
  res.writeHead(status);
  res.end();
};

export const sendCaughtError = (res: ServerResponse, error: unknown, fallbackMessage: string) => {
  if (error instanceof RequestBodyTooLargeError) {
    sendJson(res, 413, {
      status: 'payload_too_large',
      message: error.message
    });
    return;
  }

  sendJson(res, 500, {
    status: 'error',
    message: error instanceof Error ? error.message : fallbackMessage
  });
};

export const readRequestJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyTooLargeError(MAX_JSON_BODY_BYTES);
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw.trim()) {
    return null;
  }

  return JSON.parse(raw) as unknown;
};
