import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateVideoPoster,
  getActiveVideoPosterTasks,
  getCachedVideoPoster,
  isVideoPosterAbortError
} from '../src/services/video-poster.service.js';

let activeVideoLoads = 0;
let maximumActiveVideoLoads = 0;
let frameCallbacks = 0;
let canvasDraws = 0;
let drawsBeforeDecodedFrame = 0;
let forceTimeout = false;
const revokedObjectUrls: string[] = [];

class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  preload = '';
  src = '';
  duration = 10;
  readyState = 2;
  videoWidth = 640;
  videoHeight = 360;
  error: { code: number } | null = null;
  private loaded = false;
  private decodedFrame = false;
  private time = 0;

  get currentTime() {
    return this.time;
  }

  set currentTime(value: number) {
    this.time = value;
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }

  pause() {}

  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }

  load() {
    if (!this.src) {
      if (this.loaded) activeVideoLoads -= 1;
      this.loaded = false;
      return;
    }
    if (!this.loaded) {
      this.loaded = true;
      activeVideoLoads += 1;
      maximumActiveVideoLoads = Math.max(maximumActiveVideoLoads, activeVideoLoads);
    }
    if (this.src.includes('stalled')) return;
    if (this.src.includes('unsupported')) {
      this.error = { code: 4 };
      queueMicrotask(() => this.dispatchEvent(new Event('error')));
      return;
    }
    queueMicrotask(() => {
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('loadeddata'));
    });
  }

  requestVideoFrameCallback(callback: () => void) {
    frameCallbacks += 1;
    const id = frameCallbacks;
    queueMicrotask(() => {
      this.decodedFrame = true;
      callback();
    });
    return id;
  }

  cancelVideoFrameCallback() {}

  wasDecoded() {
    return this.decodedFrame;
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  private source: FakeVideo | null = null;

  getContext() {
    return {
      drawImage: (video: FakeVideo) => {
        this.source = video;
        canvasDraws += 1;
        if (!video.wasDecoded()) drawsBeforeDecodedFrame += 1;
      }
    };
  }

  toDataURL() {
    assert.ok(this.source);
    return `data:image/jpeg;base64,poster-${canvasDraws}`;
  }
}

Object.assign(globalThis, {
  HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
  document: {
    createElement(tagName: string) {
      if (tagName === 'video') return new FakeVideo();
      if (tagName === 'canvas') return new FakeCanvas();
      throw new Error(`Unexpected element: ${tagName}`);
    }
  },
  window: {
    setTimeout(callback: () => void, delay: number) {
      if (forceTimeout && delay === 8_000) queueMicrotask(callback);
      return globalThis.setTimeout(callback, forceTimeout && delay === 8_000 ? 60_000 : delay) as unknown as number;
    },
    clearTimeout(handle: number) {
      globalThis.clearTimeout(handle);
    }
  },
  fetch(url: string) {
    return Promise.resolve({
      ok: !url.includes('fetch-fail'),
      status: url.includes('fetch-fail') ? 503 : 200,
      blob: async () => ({ sourceUrl: url })
    });
  },
  URL: {
    createObjectURL(blob: { sourceUrl?: string }) {
      return `blob:${blob.sourceUrl ?? 'unknown'}`;
    },
    revokeObjectURL(url: string) {
      revokedObjectUrls.push(url);
    }
  }
});

test('video poster generation serializes streams, waits for a decoded frame and caches the result', async () => {
  maximumActiveVideoLoads = 0;
  frameCallbacks = 0;
  canvasDraws = 0;
  drawsBeforeDecodedFrame = 0;
  revokedObjectUrls.length = 0;

  const first = generateVideoPoster('behavior:first', '/first.mp4');
  const second = generateVideoPoster('behavior:second', '/second.mov');
  const [firstPoster, secondPoster] = await Promise.all([first, second]);

  assert.match(firstPoster, /^data:image\/jpeg/);
  assert.match(secondPoster, /^data:image\/jpeg/);
  assert.equal(maximumActiveVideoLoads, 1);
  assert.equal(frameCallbacks, 2);
  assert.equal(drawsBeforeDecodedFrame, 0);
  assert.equal(activeVideoLoads, 0);
  assert.equal(getActiveVideoPosterTasks(), 0);
  assert.deepEqual(revokedObjectUrls, ['blob:/first.mp4', 'blob:/second.mov']);

  const drawsBeforeCacheRead = canvasDraws;
  assert.equal(await generateVideoPoster('behavior:first', '/first.mp4'), getCachedVideoPoster('behavior:first'));
  assert.equal(canvasDraws, drawsBeforeCacheRead);
});

test('active and queued poster cancellations release their video resources', async () => {
  const activeController = new AbortController();
  const queuedController = new AbortController();
  const active = generateVideoPoster('behavior:stalled', '/stalled.mp4', undefined, activeController.signal);
  const queued = generateVideoPoster('behavior:queued', '/queued.mp4', undefined, queuedController.signal);
  queuedController.abort();
  activeController.abort();

  await assert.rejects(queued, isVideoPosterAbortError);
  await assert.rejects(active, isVideoPosterAbortError);
  assert.equal(activeVideoLoads, 0);
  assert.equal(getActiveVideoPosterTasks(), 0);
  assert.equal(getCachedVideoPoster('behavior:stalled'), null);
});

test('decode errors and timeouts become failures without leaving streams open', async () => {
  await assert.rejects(generateVideoPoster('behavior:unsupported', '/unsupported.mov'), /media error 4/);
  assert.equal(activeVideoLoads, 0);

  forceTimeout = true;
  await assert.rejects(generateVideoPoster('behavior:timeout', '/stalled-timeout.mp4'), /timed out/);
  forceTimeout = false;
  assert.equal(activeVideoLoads, 0);
  assert.equal(getActiveVideoPosterTasks(), 0);
});

test('poster generation falls back to the full media URL when the poster stream fails', async () => {
  const poster = await generateVideoPoster('behavior:fallback', '/fetch-fail-poster.mp4', '/fallback.mov');

  assert.match(poster, /^data:image\/jpeg/);
  assert.equal(getCachedVideoPoster('behavior:fallback'), poster);
});
