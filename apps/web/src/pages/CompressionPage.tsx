import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useFolderSelections } from '../hooks/useFolderSelections';
import {
  loadFolderSelectionHandle,
  loadSourceTreeSnapshot,
  type SourceTreeDirectoryNode,
  type SourceTreeNode
} from '../services/folder-selection.store';

type ImagePresetId = 'balanced' | 'high' | 'aggressive' | 'custom';
type VideoPresetId = 'fast' | 'balanced' | 'quality';

type MediaStats = {
  imageCount: number;
  imageBytes: number;
  videoCount: number;
  videoBytes: number;
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

const mergeMediaStats = (base: MediaStats, extra: MediaStats): MediaStats => ({
  imageCount: base.imageCount + extra.imageCount,
  imageBytes: base.imageBytes + extra.imageBytes,
  videoCount: base.videoCount + extra.videoCount,
  videoBytes: base.videoBytes + extra.videoBytes
});

const summarizeSnapshotNode = (node: SourceTreeNode): MediaStats => {
  if (node.kind === 'file') {
    const kind = getMediaKind(node.name, '', node.fileType);

    if (kind === 'image') {
      return { imageCount: 1, imageBytes: node.sizeBytes, videoCount: 0, videoBytes: 0 };
    }

    if (kind === 'video') {
      return { imageCount: 0, imageBytes: 0, videoCount: 1, videoBytes: node.sizeBytes };
    }

    return createEmptyMediaStats();
  }

  return node.children.reduce((accumulator, child) => mergeMediaStats(accumulator, summarizeSnapshotNode(child)), createEmptyMediaStats());
};

const summarizeSnapshot = (root: SourceTreeDirectoryNode): MediaStats => summarizeSnapshotNode(root);

const summarizeNativeDirectory = async (handle: FileSystemDirectoryHandle): Promise<MediaStats> => {
  let stats = createEmptyMediaStats();

  for await (const [, entry] of handle.entries()) {
    if (entry.kind === 'directory') {
      const childStats = await summarizeNativeDirectory(entry as FileSystemDirectoryHandle);
      stats = mergeMediaStats(stats, childStats);
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
  if (quality >= 92) {
    return 0.08;
  }

  if (quality >= 85) {
    return 0.16;
  }

  if (quality >= 75) {
    return 0.28;
  }

  if (quality >= 65) {
    return 0.4;
  }

  return 0.52;
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

export const CompressionPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceSelection } = useFolderSelections();
  const [imagePreset, setImagePreset] = useState<ImagePresetId>('balanced');
  const [customQuality, setCustomQuality] = useState<number>(72);
  const [videoPreset, setVideoPreset] = useState<VideoPresetId>('balanced');
  const [mediaStatsState, setMediaStatsState] = useState<MediaStatsState>({ status: 'idle', data: null, error: null });

  const activePreset = IMAGE_PRESETS.find((preset) => preset.id === imagePreset);
  const effectiveImageQuality = imagePreset === 'custom' ? customQuality : (activePreset?.quality ?? 80);
  const selectedImageProfileLabel = imagePreset === 'custom' ? 'Custom' : (activePreset?.label ?? 'Balanced');
  const selectedVideoProfileLabel = videoPreset === 'quality' ? 'Quality' : videoPreset === 'fast' ? 'Fast' : 'Balanced';
  const imageSavingsHint = useMemo(() => {
    if (effectiveImageQuality >= 90) {
      return 'est. 1,100 MB saved';
    }

    if (effectiveImageQuality >= 80) {
      return 'est. 1,800 MB saved';
    }

    return 'est. 2,400 MB saved';
  }, [effectiveImageQuality]);

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

        let nextStats: MediaStats | null = null;

        if (handle) {
          nextStats = await summarizeNativeDirectory(handle);
        } else if (snapshot) {
          nextStats = summarizeSnapshot(snapshot);
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

  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Optimize your media</h2>
        <p className="page-subtitle">
          Choose compression profiles for images and videos to reduce file size while maintaining quality.
        </p>
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
        <button className="btn btn-primary" type="button" onClick={() => navigate('/grouping', { state: { from: '/compression' } })}>
          Continue to Grouping →
        </button>
      </div>
    </div>
  );
};

export default CompressionPage;
