import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useCompressionJobState } from '../hooks/useCompressionJobState';
import {
  loadSourceSelectionScope,
  loadFolderSelectionHandle,
  loadSourceTreeSnapshot,
  type SourceSelectionScopeSnapshot,
  type SourceTreeDirectoryNode,
  type SourceTreeNode
} from '../services/folder-selection.store';
import { loadEncoderSettings, type EncoderSettingsSnapshot } from '../services/encoder-settings.store';
import { completeCompressionJob, failCompressionJob, startCompressionJob, resetCompressionJob } from '../services/compression-job.store';
import { getCompressionJobRequest, startCompressionJobRequest } from '../services/compression.service';
import { scanSourceTreeRequest } from '../services/source-tree.service';

type ImagePresetId = 'balanced' | 'high' | 'aggressive' | 'custom';
type VideoPresetId = 'fast' | 'balanced' | 'quality';

type MediaStats = {
  imageCount: number;
  imageBytes: number;
  videoCount: number;
  videoBytes: number;
};

type ScopeSets = {
  excludedDirectories: Set<string>;
  excludedFiles: Set<string>;
  includedDirectories: Set<string>;
  includedFiles: Set<string>;
};

type MediaStatsState =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: MediaStats; error: null }
  | { status: 'error'; data: null; error: string };

const IMAGE_PRESETS: Array<{ id: Exclude<ImagePresetId, 'custom'>; label: string; quality: number; note: string }> = [
  { id: 'balanced', label: 'Balanced', quality: 80, note: 'Great default for mixed galleries' },
  { id: 'high', label: 'High', quality: 90, note: 'Higher quality, lighter compression' },
  { id: 'aggressive', label: 'Aggressive', quality: 70, note: 'Smaller files with stronger compression' }
];

const clampQuality = (value: number) => {
  if (Number.isNaN(value)) {
    return 80;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

const getMediaKind = (fileName: string, mimeType = '', fileType = ''): 'image' | 'video' | 'other' => {
  const normalizedType = fileType.toLowerCase();

  if (normalizedType.includes('image')) {
    return 'image';
  }

  if (normalizedType.includes('video')) {
    return 'video';
  }

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(extension)) {
    return 'image';
  }

  if (['mp4', 'mov', 'm4v', 'avi', 'mkv'].includes(extension)) {
    return 'video';
  }

  return 'other';
};

const createEmptyMediaStats = (): MediaStats => ({
  imageCount: 0,
  imageBytes: 0,
  videoCount: 0,
  videoBytes: 0
});

const createDefaultScopeSets = (): ScopeSets => ({
  excludedDirectories: new Set(),
  excludedFiles: new Set(),
  includedDirectories: new Set(),
  includedFiles: new Set()
});

type ScannedDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  depth: number;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  children: Array<ScannedDirectory | {
    kind: 'file';
    name: string;
    path: string;
    depth: number;
    sizeBytes: number;
    fileType: string;
  }>;
};

const toScopeSets = (scope: SourceSelectionScopeSnapshot | null): ScopeSets => {
  if (!scope) {
    return createDefaultScopeSets();
  }

  return {
    excludedDirectories: new Set(scope.excludedDirectories),
    excludedFiles: new Set(scope.excludedFiles),
    includedDirectories: new Set(scope.includedDirectories),
    includedFiles: new Set(scope.includedFiles)
  };
};

const isUnderExcludedAncestor = (path: string, scope: ScopeSets) => {
  const segments = path.split('/').filter(Boolean);
  let currentPath = '';
  let ancestorExcluded = false;

  for (let index = 0; index < segments.length - 1; index += 1) {
    currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];

    if (scope.excludedDirectories.has(currentPath)) {
      ancestorExcluded = true;
    }

    if (ancestorExcluded && scope.includedDirectories.has(currentPath)) {
      ancestorExcluded = false;
    }
  }

  return ancestorExcluded;
};

const extractCompressionErrorDetails = (payloadJson: string | null): { completedCount: number; failedCount: number; failedItems: Array<{ source: string; error?: string }> } => {
  if (!payloadJson) {
    return { completedCount: 0, failedCount: 0, failedItems: [] };
  }

  try {
    const payload = JSON.parse(payloadJson) as {
      summary?: { completedItems: number; failedItems: number };
      image?: { items: Array<{ source: string; status: string; error?: string }> };
      video?: { items: Array<{ source: string; status: string; error?: string }> };
    };

    const completedCount = payload.summary?.completedItems ?? 0;
    const failedCount = payload.summary?.failedItems ?? 0;

    const failedItems: Array<{ source: string; error?: string }> = [];

    if (payload.image?.items) {
      for (const item of payload.image.items) {
        if (item.status === 'failed') {
          failedItems.push({ source: item.source, error: item.error });
        }
      }
    }

    if (payload.video?.items) {
      for (const item of payload.video.items) {
        if (item.status === 'failed') {
          failedItems.push({ source: item.source, error: item.error });
        }
      }
    }

    return { completedCount, failedCount, failedItems };
  } catch (e) {
    return { completedCount: 0, failedCount: 0, failedItems: [] };
  }
};

function isFileIncludedByScope(path: string, scope: ScopeSets) {
  const ancestorExcluded = isUnderExcludedAncestor(path, scope);

  if (scope.excludedFiles.has(path)) {
    return false;
  }

  if (!ancestorExcluded) {
    return true;
  }

  return scope.includedFiles.has(path);
}

const mergeMediaStats = (base: MediaStats, extra: MediaStats): MediaStats => ({
  imageCount: base.imageCount + extra.imageCount,
  imageBytes: base.imageBytes + extra.imageBytes,
  videoCount: base.videoCount + extra.videoCount,
  videoBytes: base.videoBytes + extra.videoBytes
});

const summarizeSnapshotNode = (node: SourceTreeNode, scope: ScopeSets): MediaStats => {
  if (node.kind === 'file') {
    if (!isFileIncludedByScope(node.path, scope)) {
      return createEmptyMediaStats();
    }

    const kind = getMediaKind(node.name, '', node.fileType);

    if (kind === 'image') {
      return { imageCount: 1, imageBytes: node.sizeBytes, videoCount: 0, videoBytes: 0 };
    }

    if (kind === 'video') {
      return { imageCount: 0, imageBytes: 0, videoCount: 1, videoBytes: node.sizeBytes };
    }

    return createEmptyMediaStats();
  }

  return node.children.reduce(
    (accumulator, child) => mergeMediaStats(accumulator, summarizeSnapshotNode(child, scope)),
    createEmptyMediaStats()
  );
};

const summarizeSnapshot = (root: SourceTreeDirectoryNode, scope: ScopeSets): MediaStats => summarizeSnapshotNode(root, scope);

const summarizeNativeDirectory = async (
  handle: FileSystemDirectoryHandle,
  scope: ScopeSets,
  currentPath = handle.name
): Promise<MediaStats> => {
  let stats = createEmptyMediaStats();

  for await (const [entryName, entry] of handle.entries()) {
    const entryPath = `${currentPath}/${entryName}`;

    if (entry.kind === 'directory') {
      const childStats = await summarizeNativeDirectory(entry as FileSystemDirectoryHandle, scope, entryPath);
      stats = mergeMediaStats(stats, childStats);
      continue;
    }

    if (!isFileIncludedByScope(entryPath, scope)) {
      continue;
    }

    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    const kind = getMediaKind(file.name, file.type);

    if (kind === 'image') {
      stats = mergeMediaStats(stats, { imageCount: 1, imageBytes: file.size, videoCount: 0, videoBytes: 0 });
      continue;
    }

    if (kind === 'video') {
      stats = mergeMediaStats(stats, { imageCount: 0, imageBytes: 0, videoCount: 1, videoBytes: file.size });
    }
  }

  return stats;
};

const estimateImageSavingsRatio = (quality: number) => {
  const normalizedQuality = clampQuality(quality);
  const linearRatio = 1.24 - 0.012 * normalizedQuality;

  return Math.min(0.56, Math.max(0.04, linearRatio));
};

const estimateVideoSavingsRatio = (preset: VideoPresetId) => {
  if (preset === 'quality') {
    return 0.14;
  }

  if (preset === 'balanced') {
    return 0.24;
  }

  return 0.32;
};

const isLikelyAbsolutePath = (value: string) => {
  if (!value) {
    return false;
  }

  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
};

export const CompressionPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const compressionJobState = useCompressionJobState();
  const [imagePreset, setImagePreset] = useState<ImagePresetId>('balanced');
  const [customQuality, setCustomQuality] = useState<number>(72);
  const [videoPreset, setVideoPreset] = useState<VideoPresetId>('balanced');
  const [mediaStatsState, setMediaStatsState] = useState<MediaStatsState>({ status: 'idle', data: null, error: null });
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isStartingCompression, setIsStartingCompression] = useState(false);
  const [encoderSettings, setEncoderSettings] = useState<EncoderSettingsSnapshot>({
    imageToolCommand: '',
    videoToolCommand: '',
    updatedAt: 0
  });
  const completionTimerRef = useRef<number | null>(null);

  const activePreset = IMAGE_PRESETS.find((preset) => preset.id === imagePreset);
  const effectiveImageQuality = imagePreset === 'custom' ? customQuality : (activePreset?.quality ?? 80);
  const selectedImageProfileLabel = imagePreset === 'custom' ? 'Custom' : (activePreset?.label ?? 'Balanced');
  const selectedVideoProfileLabel = videoPreset === 'quality' ? 'Quality' : videoPreset === 'fast' ? 'Fast' : 'Balanced';

  useEffect(() => {
    loadEncoderSettings().then((settings) => {
      setEncoderSettings(settings);
    });
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadMediaStats = async () => {
      if (!sourceSelection) {
        setMediaStatsState({ status: 'idle', data: null, error: null });
        return;
      }

      setMediaStatsState({ status: 'loading', data: null, error: null });

      try {
        const handle = await loadFolderSelectionHandle('source');
        const snapshot = loadSourceTreeSnapshot('source');
        const persistedScope = loadSourceSelectionScope();
        const scopeSets = toScopeSets(persistedScope);

        let nextStats: MediaStats | null = null;

        if (handle) {
          nextStats = await summarizeNativeDirectory(handle, scopeSets);
        } else if (snapshot) {
          nextStats = summarizeSnapshot(snapshot, scopeSets);
        } else if (sourceSelection.path) {
          const scannedTree = await scanSourceTreeRequest(sourceSelection.path);
          nextStats = summarizeSnapshot(scannedTree as SourceTreeDirectoryNode, scopeSets);
        }

        if (!nextStats) {
          throw new Error('No source tree data is available yet. Go back to Import and reselect the source folder.');
        }

        if (!isActive) {
          return;
        }

        setMediaStatsState({ status: 'ready', data: nextStats, error: null });
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Could not load source media stats.';
        setMediaStatsState({ status: 'error', data: null, error: message });
      }
    };

    void loadMediaStats();

    return () => {
      isActive = false;
    };
  }, [sourceSelection?.updatedAt]);

  useEffect(() => {
    if (compressionJobState.status !== 'running' || !compressionJobState.backendJobId) {
      return;
    }

    let isActive = true;

    const reconcileRunningState = async () => {
      try {
        const job = await getCompressionJobRequest(compressionJobState.backendJobId as string);

        if (!isActive) {
          return;
        }

        const status = job.job.status;

        if (status === 'completed') {
          completeCompressionJob();
          setIsStartingCompression(false);
          return;
        }

        if (status === 'failed' || status === 'cancelled') {
          const errorDetails = extractCompressionErrorDetails(job.checkpoint?.payloadJson ?? null);
          const message = errorDetails.failedCount > 0
            ? `${errorDetails.completedCount} items completed, ${errorDetails.failedCount} items failed`
            : `Compression job ended with status: ${status}`;

          failCompressionJob(message);
          setBackendError(message);
          setIsStartingCompression(false);
        }
      } catch {
        if (!isActive) {
          return;
        }

        resetCompressionJob();
        setIsStartingCompression(false);
        setBackendError('Detected stale compression state and reset it. You can start a new compression job now.');
      }
    };

    void reconcileRunningState();

    return () => {
      isActive = false;
    };
  }, [compressionJobState.backendJobId, compressionJobState.status]);

  const imageEstimatedSavedBytes = useMemo(() => {
    if (mediaStatsState.status !== 'ready') {
      return 0;
    }

    return Math.round(mediaStatsState.data.imageBytes * estimateImageSavingsRatio(effectiveImageQuality));
  }, [mediaStatsState, effectiveImageQuality]);

  const videoEstimatedSavedBytes = useMemo(() => {
    if (mediaStatsState.status !== 'ready') {
      return 0;
    }

    return Math.round(mediaStatsState.data.videoBytes * estimateVideoSavingsRatio(videoPreset));
  }, [mediaStatsState, videoPreset]);

  const handleBack = () => {
    const from = (location.state as { from?: string } | null)?.from;

    if (from && from !== location.pathname) {
      navigate(from);
      return;
    }

    navigate('/selection');
  };

  const sourcePath = sourceSelection?.path ?? '';
  const destinationPath = destinationSelection?.path ?? '';
  const hasConfiguredEncoders = Boolean(encoderSettings.imageToolCommand.trim() && encoderSettings.videoToolCommand.trim());
  const canStartRealCompression =
    isLikelyAbsolutePath(sourcePath) &&
    isLikelyAbsolutePath(destinationPath) &&
    hasConfiguredEncoders;

  const handleStartCompression = async () => {
    if (!destinationSelection || !sourceSelection || mediaStatsState.status === 'error') {
      return;
    }

    if (!canStartRealCompression) {
      setBackendError(
        !hasConfiguredEncoders
          ? 'Configure and save both encoder paths in Settings before starting compression.'
          : 'Real compression requires absolute source and destination paths. Use fallback path mode in Import for now.'
      );
      return;
    }

    setBackendError(null);
    setIsStartingCompression(true);

    try {
      const started = await startCompressionJobRequest({
        sourceDir: sourcePath,
        outputDir: destinationPath,
        imageQuality: effectiveImageQuality,
        imageProfileLabel: selectedImageProfileLabel,
        videoPresetLabel: selectedVideoProfileLabel,
        imageToolCommand: encoderSettings.imageToolCommand,
        videoToolCommand: encoderSettings.videoToolCommand,
        selectionScope: loadSourceSelectionScope()
      });

      startCompressionJob({
        backendJobId: started.job.id,
        imageProfileLabel: selectedImageProfileLabel,
        imageQuality: effectiveImageQuality,
        videoPresetLabel: selectedVideoProfileLabel,
        outputRootLabel: destinationPath
      });

      const poll = async () => {
        const job = await getCompressionJobRequest(started.job.id);
        const status = job.job.status;

        if (status === 'completed') {
          completeCompressionJob();
          setIsStartingCompression(false);
          navigate('/grouping', { state: { from: '/compression' } });
          return;
        }

        if (status === 'failed' || status === 'cancelled') {
          const errorDetails = extractCompressionErrorDetails(job.checkpoint?.payloadJson ?? null);
          let errorMessage = `Compression job ended with status: ${status}`;

          if (errorDetails.failedCount > 0) {
            errorMessage = `${errorDetails.completedCount} items completed, ${errorDetails.failedCount} items failed`;

            if (errorDetails.failedItems.length > 0) {
              const failedReasons = errorDetails.failedItems
                .slice(0, 3)
                .map((item) => {
                  const reason = item.error || 'Unknown error';
                  return `• ${item.source.split('/').pop() || item.source}: ${reason}`;
                })
                .join('\n');

              errorMessage += `\n\nFailed items:\n${failedReasons}`;

              if (errorDetails.failedItems.length > 3) {
                errorMessage += `\n... and ${errorDetails.failedItems.length - 3} more`;
              }
            }
          }

          failCompressionJob(errorMessage);
          setBackendError(errorMessage);
          setIsStartingCompression(false);
          return;
        }

        completionTimerRef.current = window.setTimeout(() => {
          void poll();
        }, 1000);
      };

      await poll();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start compression job.';
      failCompressionJob(message);
      setBackendError(message);
      setIsStartingCompression(false);
    }
  };

  useEffect(() => {
    return () => {
      if (completionTimerRef.current) {
        window.clearTimeout(completionTimerRef.current);
      }
    };
  }, []);

  const isCompressionRunning = compressionJobState.status === 'running' || isStartingCompression;
  const isCompressionComplete = compressionJobState.status === 'completed';

  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Optimize your media</h2>
        <p className="page-subtitle">
          Choose compression settings for images and videos, then launch the compression jobs from here. Grouping unlocks after processing completes.
        </p>
      </div>

      <div className="page-card">
        <p className="page-section-title">Compression job</p>
        <p className="page-summary-note">
          Outputs will be written under the selected Destination folder{destinationPath ? ` (${destinationPath})` : ''}.
        </p>
        {!canStartRealCompression && (
          <p className="error">
            {!hasConfiguredEncoders
              ? 'Compression is blocked until both encoder paths are configured and saved in Settings.'
              : 'Real backend compression needs absolute filesystem paths for Source and Destination.'}
          </p>
        )}
        {backendError && (
          <pre className="error compression-error-details">
            {backendError}
          </pre>
        )}
        {compressionJobState.status === 'idle' && <p className="page-summary-note">No compression job has been started yet.</p>}
        {compressionJobState.status === 'running' && <p className="page-summary-note">Compression jobs are running. Grouping stays locked until they finish.</p>}
        {compressionJobState.status === 'completed' && <p className="page-summary-note">Compression is complete. You can continue to grouping.</p>}
        {compressionJobState.status === 'failed' && (
          <div className="compression-error-section">
            <p className="error">Compression failed: {compressionJobState.errorMessage ?? 'Check backend logs and tool installation.'}</p>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => resetCompressionJob()}
            >
              ↻ Try Again
            </button>
          </div>
        )}
      </div>

      <div className="page-grid-2">
        <div className="page-card">
          <h3 className="page-section-title">📸 Image compression</h3>
          <p className="page-summary-note">mozjpeg quality (`cjpeg -quality`)</p>

          <div className="page-option-list">
            {IMAGE_PRESETS.map((preset) => (
              <label className="page-option" key={preset.id}>
                <input
                  type="radio"
                  name="image"
                  checked={imagePreset === preset.id}
                  onChange={() => setImagePreset(preset.id)}
                />
                <span className="page-option-label">
                  <strong>{preset.label}</strong> ({preset.quality}% quality) - {preset.note}
                </span>
              </label>
            ))}

            <label className="page-option">
              <input type="radio" name="image" checked={imagePreset === 'custom'} onChange={() => setImagePreset('custom')} />
              <span className="page-option-label">
                <strong>Custom</strong> (set your own quality)
              </span>
            </label>

            {imagePreset === 'custom' && (
              <label className="compression-custom-quality" htmlFor="image-quality-custom">
                <span className="page-option-label">
                  <strong>Custom quality</strong> (0-100)
                </span>
                <input
                  id="image-quality-custom"
                  className="compression-quality-input"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={customQuality}
                  onChange={(event) => setCustomQuality(clampQuality(Number(event.target.value)))}
                />
                <span className="page-summary-note">Example command: `cjpeg -quality {customQuality} -progressive -optimize ...`</span>
              </label>
            )}
          </div>
        </div>

        <div className="page-card">
          <h3 className="page-section-title">🎬 Video compression</h3>
          <p className="page-summary-note">HandBrake presets</p>

          <div className="page-option-list">
            <label className="page-option">
              <input type="radio" name="video" checked={videoPreset === 'fast'} onChange={() => setVideoPreset('fast')} />
              <span className="page-option-label">
                <strong>Fast</strong> (Quick encoding)
              </span>
            </label>
            <label className="page-option">
              <input type="radio" name="video" checked={videoPreset === 'balanced'} onChange={() => setVideoPreset('balanced')} />
              <span className="page-option-label">
                <strong>Balanced</strong> (Standard)
              </span>
            </label>
            <label className="page-option">
              <input type="radio" name="video" checked={videoPreset === 'quality'} onChange={() => setVideoPreset('quality')} />
              <span className="page-option-label">
                <strong>Quality</strong> (Slower, better)
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="page-card">
        <p className="page-summary-label">Summary</p>
        {mediaStatsState.status === 'loading' && <p className="page-summary-note">Reading real media stats from the selected source...</p>}
        {mediaStatsState.status === 'error' && <p className="error">{mediaStatsState.error}</p>}
        {mediaStatsState.status === 'idle' && <p className="page-summary-note">Select a source folder in Import to see real summary metrics.</p>}
        <div className="page-summary">
          {mediaStatsState.status === 'ready' && (
            <>
              <p>
                📸 {mediaStatsState.data.imageCount} photos will be compressed with {selectedImageProfileLabel} profile (quality {effectiveImageQuality}, est. {formatBytes(imageEstimatedSavedBytes)} saved)
              </p>
              <p>
                🎬 {mediaStatsState.data.videoCount} videos will be compressed with {selectedVideoProfileLabel} preset (est. {formatBytes(videoEstimatedSavedBytes)} saved)
              </p>
              <p className="page-summary-note">
                Estimates are heuristic and will be refined when pipeline execution metrics are connected.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button" onClick={handleBack}>
          ← Back
        </button>
        <button className="btn btn-primary" type="button" onClick={() => void handleStartCompression()} disabled={isCompressionRunning || !canStartRealCompression}>
          {isCompressionRunning ? 'Compression running...' : 'Start Compression Jobs'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => navigate('/grouping', { state: { from: '/compression' } })} disabled={!isCompressionComplete}>
          Continue to Grouping →
        </button>
      </div>
    </div>
  );
};

export default CompressionPage;
