import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { createDesktopMediaResponse, resolveDesktopMediaDescriptorTarget } from '../src/desktopMedia.js';
import { cleanupTrackedTestTempDirectories, createTrackedTestTempDirectory } from '../../../test-utils/tempDirectory.js';

const tempRoot = createTrackedTestTempDirectory('media-organizer-desktop-media-');
const content = Buffer.from('0123456789abcdef');
const mediaPaths = {
  mp4: path.join(tempRoot, 'video.mp4'),
  mov: path.join(tempRoot, 'video.mov')
};
fs.writeFileSync(mediaPaths.mp4, content);
fs.writeFileSync(mediaPaths.mov, content);

after(() => cleanupTrackedTestTempDirectories());

test('resolves only grouping media requests to the private descriptor endpoint', () => {
  assert.equal(
    resolveDesktopMediaDescriptorTarget(4100, new URL('media-organizer://app/api/grouping/session/items/item/media?usage=poster')),
    'http://127.0.0.1:4100/internal/grouping/session/items/item/media-path'
  );
  assert.equal(resolveDesktopMediaDescriptorTarget(4100, new URL('media-organizer://app/api/health')), null);
});

for (const extension of ['mp4', 'mov'] as const) {
  test(`serves complete, ranged, suffix and HEAD ${extension.toUpperCase()} responses`, async () => {
    const descriptor = {
      path: mediaPaths[extension],
      contentType: extension === 'mp4' ? 'video/mp4' : 'video/quicktime'
    };

    const complete = createDesktopMediaResponse(new Request('media-organizer://app/video'), descriptor);
    assert.equal(complete.status, 200);
    assert.equal(complete.headers.get('accept-ranges'), 'bytes');
    assert.equal(complete.headers.get('content-length'), String(content.length));
    assert.equal(complete.headers.get('content-type'), descriptor.contentType);
    assert.equal(complete.headers.get('content-range'), null);
    assert.equal(complete.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await complete.arrayBuffer()), content);

    const poster = createDesktopMediaResponse(
      new Request('media-organizer://app/video?usage=poster'),
      descriptor
    );
    assert.equal(poster.status, 206);
    assert.equal(poster.headers.get('content-range'), `bytes 0-15/${content.length}`);
    assert.equal(poster.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await poster.arrayBuffer()), content);

    const initial = createDesktopMediaResponse(new Request('media-organizer://app/video', {
      headers: { Range: 'bytes=0-3' }
    }), descriptor);
    assert.equal(initial.status, 206);
    assert.equal(initial.headers.get('content-range'), `bytes 0-3/${content.length}`);
    assert.deepEqual(Buffer.from(await initial.arrayBuffer()), content.subarray(0, 4));

    const open = createDesktopMediaResponse(new Request('media-organizer://app/video', {
      headers: { Range: 'bytes=10-' }
    }), descriptor);
    assert.equal(open.status, 206);
    assert.equal(open.headers.get('content-range'), `bytes 10-15/${content.length}`);
    assert.deepEqual(Buffer.from(await open.arrayBuffer()), content.subarray(10));

    const suffix = createDesktopMediaResponse(new Request('media-organizer://app/video', {
      headers: { Range: 'bytes=-5' }
    }), descriptor);
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get('content-range'), `bytes 11-15/${content.length}`);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), content.subarray(-5));

    const clamped = createDesktopMediaResponse(new Request('media-organizer://app/video', {
      headers: { Range: 'bytes=12-999' }
    }), descriptor);
    assert.equal(clamped.status, 206);
    assert.equal(clamped.headers.get('content-range'), `bytes 12-15/${content.length}`);
    assert.deepEqual(Buffer.from(await clamped.arrayBuffer()), content.subarray(12));

    const head = createDesktopMediaResponse(new Request('media-organizer://app/video', {
      method: 'HEAD'
    }), descriptor);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(content.length));
    assert.equal(await head.text(), '');

    const invalid = createDesktopMediaResponse(new Request('media-organizer://app/video', {
      headers: { Range: 'bytes=99-' }
    }), descriptor);
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), `bytes */${content.length}`);
    assert.equal(invalid.headers.get('content-length'), '0');
  });
}

test('cancelling the protocol response destroys the local file stream', async () => {
  const largePath = path.join(tempRoot, 'large.mp4');
  fs.writeFileSync(largePath, Buffer.alloc(4 * 1024 * 1024, 'x'));
  let openedStream: fs.ReadStream | null = null;
  const response = createDesktopMediaResponse(
    new Request('media-organizer://app/video'),
    { path: largePath, contentType: 'video/mp4' },
    {
      createReadStream(filePath, range) {
        openedStream = fs.createReadStream(filePath, range);
        return openedStream;
      }
    }
  );
  const reader = response.body!.getReader();
  await reader.read();
  assert.ok(openedStream);
  const closed = new Promise<void>((resolve) => openedStream!.once('close', resolve));
  openedStream.once('error', () => undefined);
  await reader.cancel();
  await closed;
  assert.equal(openedStream.destroyed, true);
});

test('limits poster responses without ranges while preserving explicit ranges', async () => {
  const largePath = path.join(tempRoot, 'poster-limit.mp4');
  const posterLimit = 12 * 1024 * 1024;
  fs.writeFileSync(largePath, Buffer.alloc(posterLimit + 1024, 'p'));
  const descriptor = { path: largePath, contentType: 'video/mp4' };

  const limited = createDesktopMediaResponse(
    new Request('media-organizer://app/video?usage=poster'),
    descriptor
  );
  assert.equal(limited.status, 206);
  assert.equal(limited.headers.get('content-length'), String(posterLimit));
  assert.equal(limited.headers.get('content-range'), `bytes 0-${posterLimit - 1}/${posterLimit + 1024}`);
  await limited.body?.cancel();

  const explicit = createDesktopMediaResponse(new Request('media-organizer://app/video?usage=poster', {
    headers: { Range: `bytes=${posterLimit}-${posterLimit + 15}` }
  }), descriptor);
  assert.equal(explicit.status, 206);
  assert.equal(explicit.headers.get('content-range'), `bytes ${posterLimit}-${posterLimit + 15}/${posterLimit + 1024}`);
  await explicit.body?.cancel();
});
