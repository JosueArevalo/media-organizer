type PosterTask = () => Promise<void>;

const MAX_CONCURRENT_POSTERS = 2;
const POSTER_TIMEOUT_MS = 8_000;

const posterCache = new Map<string, string>();
const pendingTasks: PosterTask[] = [];
let activeTasks = 0;

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

const enqueuePosterTask = <T>(task: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    pendingTasks.push(async () => {
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    });
    runNextPosterTask();
  });

const cleanupVideo = (video: HTMLVideoElement) => {
  video.pause();
  video.removeAttribute('src');
  video.load();
};

const getPosterSeekTime = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) return 0.5;
  return Math.min(Math.max(duration * 0.1, 0.25), 1);
};

const captureVideoPoster = (url: string) =>
  new Promise<string>((resolve, reject) => {
    const video = document.createElement('video');
    let finished = false;
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error('Video poster generation timed out.')));
    }, POSTER_TIMEOUT_MS);

    const finish = (complete: () => void) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      cleanupVideo(video);
      complete();
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('error', () => finish(() => reject(new Error('Video poster generation failed.'))), { once: true });
    const capture = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      try {
        const width = video.videoWidth || 320;
        const height = video.videoHeight || 180;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Canvas is not available.'));
          return;
        }

        context.drawImage(video, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      } catch (error) {
        reject(error);
      } finally {
        cleanupVideo(video);
      }
    };
    video.addEventListener('loadedmetadata', () => {
      try {
        video.currentTime = getPosterSeekTime(video.duration);
      } catch {
        capture();
      }
    }, { once: true });
    video.addEventListener('seeked', capture, { once: true });
    video.addEventListener('loadeddata', () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !Number.isFinite(video.duration)) {
        capture();
      }
    }, { once: true });
    video.src = url;
    video.load();
  });

export const getCachedVideoPoster = (cacheKey: string) => posterCache.get(cacheKey) ?? null;

export const generateVideoPoster = async (cacheKey: string, url: string) => {
  const cached = getCachedVideoPoster(cacheKey);
  if (cached) return cached;

  const poster = await enqueuePosterTask(() => captureVideoPoster(url));
  posterCache.set(cacheKey, poster);
  return poster;
};

export const getActiveVideoPosterTasks = () => activeTasks;
