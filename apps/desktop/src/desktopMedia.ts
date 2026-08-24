import fs from 'node:fs';
import { Readable } from 'node:stream';

export type DesktopMediaDescriptor = { path: string; contentType: string };

const VIDEO_POSTER_RANGE_BYTES = 12 * 1024 * 1024;

type DesktopMediaResponseOptions = {
  createReadStream?: (filePath: string, range: { start: number; end: number }) => fs.ReadStream;
};

export const resolveDesktopMediaDescriptorTarget = (backendPort: number, url: URL) => {
  const match = url.pathname.match(/^\/api\/grouping\/([^/]+)\/items\/([^/]+)\/media$/);
  if (!match) return null;
  return `http://127.0.0.1:${backendPort}/internal/grouping/${match[1]}/items/${match[2]}/media-path`;
};

const parseRange = (value: string | null, size: number) => {
  if (!value) return { start: 0, end: size - 1, partial: false };
  if (size === 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1, partial: true };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) return null;
  return { start, end: Math.min(requestedEnd, size - 1), partial: true };
};

export const createDesktopMediaResponse = (
  request: Request,
  descriptor: DesktopMediaDescriptor,
  options: DesktopMediaResponseOptions = {}
) => {
  const stats = fs.statSync(descriptor.path);
  let range = parseRange(request.method === 'HEAD' ? null : request.headers.get('range'), stats.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': '0',
        'Content-Range': `bytes */${stats.size}`,
        'Content-Type': descriptor.contentType
      }
    });
  }

  if (
    !range.partial
    && request.method !== 'HEAD'
    && descriptor.contentType.startsWith('video/')
    && new URL(request.url).searchParams.get('usage') === 'poster'
    && stats.size > 0
  ) {
    range = {
      start: 0,
      end: Math.min(stats.size - 1, VIDEO_POSTER_RANGE_BYTES - 1),
      partial: true
    };
  }

  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': String(range.end - range.start + 1),
    'Content-Type': descriptor.contentType,
    'Last-Modified': stats.mtime.toUTCString()
  });
  if (range.partial) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`);
  if (request.method === 'HEAD') return new Response(null, { status: range.partial ? 206 : 200, headers });

  if (stats.size === 0) return new Response(null, { status: 200, headers });

  const stream = options.createReadStream
    ? options.createReadStream(descriptor.path, { start: range.start, end: range.end })
    : fs.createReadStream(descriptor.path, { start: range.start, end: range.end });
  const destroyStream = () => stream.destroy();
  request.signal.addEventListener('abort', destroyStream, { once: true });
  stream.once('close', () => request.signal.removeEventListener('abort', destroyStream));
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range.partial ? 206 : 200,
    headers
  });
};
