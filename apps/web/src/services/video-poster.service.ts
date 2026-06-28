type PosterTask = () => Promise<void>;

const MAX_CONCURRENT_POSTERS = 1;
const POSTER_TIMEOUT_MS = 8_000;

const posterCache = new Map<string, string>();
const failedPosterKeys = new Set<string>();
const pendingPosters = new Map<string, Promise<string>>();
const pendingTasks: PosterTask[] = [];
let activeTasks = 0;

const createAbortError = () => new DOMException('Video poster generation was cancelled.', 'AbortError');

export const isVideoPosterAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

const runNextPosterTask = () => {
  if (activeTasks >= MAX_CONCURRENT_POSTERS) return;
  const task = pendingTasks.shift();
  if (!task) return;

  activeTasks += 1;
  void task().finally(() => {
    activeTasks -= 1;
    runNextPosterTask();
  });
};

const enqueuePosterTask = <T>(task: () => Promise<T>, signal?: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    let queued = true;
    const run = async () => {
      queued = false;
      signal?.removeEventListener('abort', cancelQueuedTask);
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    };
    const cancelQueuedTask = () => {
      if (!queued) return;
      const index = pendingTasks.indexOf(run);
      if (index >= 0) pendingTasks.splice(index, 1);
      queued = false;
      reject(createAbortError());
    };
    signal?.addEventListener('abort', cancelQueuedTask, { once: true });
    pendingTasks.push(run);
    runNextPosterTask();
  });

const cleanupVideo = (video: HTMLVideoElement) => {
  video.pause();
  video.removeAttribute('src');
  video.load();
};

const getPosterSeekTime = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const lastSafeFrame = Math.max(0, duration - 0.05);
  return Math.min(Math.max(duration * 0.1, 0.1), 1, lastSafeFrame);
};

const captureVideoPosterFromObjectUrl = (url: string, signal?: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const video = document.createElement('video');
    let finished = false;
    let frameCallbackId: number | null = null;
    let seekComplete = false;
    const settle = (complete: () => void) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(frameCallbackId);
      }
      try {
        complete();
      } finally {
        cleanupVideo(video);
      }
    };
    const abort = () => settle(() => reject(createAbortError()));
    const timeout = window.setTimeout(() => {
      settle(() => reject(new Error('Video poster generation timed out.')));
    }, POSTER_TIMEOUT_MS);

    signal?.addEventListener('abort', abort, { once: true });
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('error', () => {
      const code = video.error?.code;
      settle(() => reject(new Error(`Video poster generation failed${code ? ` (media error ${code})` : ''}.`)));
    }, { once: true });

    const capture = () => settle(() => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
        reject(new Error('Video poster frame was not decoded.'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas is not available.'));
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    });

    const captureDecodedFrame = () => {
      if (finished || !seekComplete || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        if (frameCallbackId !== null) return;
        frameCallbackId = video.requestVideoFrameCallback(() => {
          frameCallbackId = null;
          capture();
        });
      } else {
        window.setTimeout(capture, 100);
      }
    };

    video.addEventListener('loadedmetadata', () => {
      const seekTime = getPosterSeekTime(video.duration);
      if (Math.abs(video.currentTime - seekTime) < 0.01) {
        seekComplete = true;
        captureDecodedFrame();
        return;
      }
      try {
        video.currentTime = seekTime;
      } catch {
        seekComplete = true;
        captureDecodedFrame();
      }
    }, { once: true });
    video.addEventListener('seeked', () => {
      seekComplete = true;
      captureDecodedFrame();
    }, { once: true });
    video.addEventListener('loadeddata', captureDecodedFrame);
    video.src = url;
    video.load();
  });

const captureVideoPoster = async (url: string, signal?: AbortSignal) => {
  let objectUrl: string | null = null;

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`Video poster request failed with ${response.status}.`);
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    const blob = await response.blob();
    if (signal?.aborted) {
      throw createAbortError();
    }

    objectUrl = URL.createObjectURL(blob);
    return await captureVideoPosterFromObjectUrl(objectUrl, signal);
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
};

export const getCachedVideoPoster = (cacheKey: string) => posterCache.get(cacheKey) ?? null;

export const generateVideoPoster = async (cacheKey: string, url: string, fallbackUrl?: string, signal?: AbortSignal) => {
  if (signal?.aborted) throw createAbortError();
  const cached = getCachedVideoPoster(cacheKey);
  if (cached) return cached;
  if (failedPosterKeys.has(cacheKey)) throw new Error('Video poster generation previously failed.');
  const pending = pendingPosters.get(cacheKey);
  if (pending) return await pending;

  const work = enqueuePosterTask(async () => {
    try {
      return await captureVideoPoster(url, signal);
    } catch (error) {
      if (!fallbackUrl || fallbackUrl === url || isVideoPosterAbortError(error)) {
        throw error;
      }

      return await captureVideoPoster(fallbackUrl, signal);
    }
  }, signal).then((poster) => {
    posterCache.set(cacheKey, poster);
    return poster;
  }).catch((error) => {
    if (!isVideoPosterAbortError(error)) failedPosterKeys.add(cacheKey);
    throw error;
  }).finally(() => {
    pendingPosters.delete(cacheKey);
  });

  pendingPosters.set(cacheKey, work);
  return await work;
};

export const getActiveVideoPosterTasks = () => activeTasks;
