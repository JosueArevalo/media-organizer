import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useTranslation, type TranslationKey } from '../i18n';
import {
  loadSourceSelectionScope,
  loadFolderSelectionHandle,
  loadSourceTreeSnapshot,
  type SourceSelectionScopeSnapshot,
  type SourceTreeDirectoryNode,
  type SourceTreeNode
} from '../services/folder-selection.store';
import { loadEncoderSettings, type EncoderSettingsSnapshot } from '../services/encoder-settings.store';
import {
  loadCompressionSettings,
  saveCompressionSettings,
  type CompressionImagePreset,
  type VideoOutputFormatMode
} from '../services/compression-settings.store';
import { completeCompressionSession, failCompressionSession, startCompressionSession, resetCompressionSession } from '../services/compression-job.store';
import {
  getCompressionSessionRequest,
  getCompressionProgressRequest,
  loadHandBrakePresetsRequest,
  startCompressionSessionRequest,
  type HandBrakePresetOption
} from '../services/compression.service';
import { scanSourceTreeRequest } from '../services/source-tree.service';

type ImagePresetId = CompressionImagePreset;

type VideoPresetsState =
  | { status: 'idle'; error: null }
  | { status: 'loading'; error: null }
  | { status: 'ready'; error: null }
  | { status: 'error'; error: string };

type MediaStats = {
  imageCount: number;
  imageBytes: number;
  jpegImageCount: number;
  heicImageCount: number;
  copyOnlyImageCount: number;
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

type CompressionProgressItem = {
  id: string;
  sourcePath: string;
  status: 'completed' | 'failed';
  operation: 'compress' | 'copy';
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  skipped?: boolean;
};

type CompressionActiveItem = {
  id: string;
  sourcePath: string;
  operation: 'compress' | 'copy';
  startedAt?: number;
};

const IMAGE_PRESETS: Array<{ id: Exclude<ImagePresetId, 'custom'>; labelKey: TranslationKey; quality: number; noteKey: TranslationKey }> = [
  { id: 'balanced', labelKey: 'compression.preset.balanced', quality: 80, noteKey: 'compression.preset.balancedNote' },
  { id: 'high', labelKey: 'compression.preset.high', quality: 90, noteKey: 'compression.preset.highNote' },
  { id: 'aggressive', labelKey: 'compression.preset.aggressive', quality: 70, noteKey: 'compression.preset.aggressiveNote' }
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

const formatDuration = (milliseconds?: number) => {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) {
    return '';
  }

  if (milliseconds < 1000) {
    return '<1s';
  }

  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

const getFileLabel = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;

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
  jpegImageCount: 0,
  heicImageCount: 0,
  copyOnlyImageCount: 0,
  videoCount: 0,
  videoBytes: 0
});

const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() ?? '';

const createImageStats = (fileName: string, sizeBytes: number): MediaStats => {
  const extension = getFileExtension(fileName);

  return {
    imageCount: 1,
    imageBytes: sizeBytes,
    jpegImageCount: ['jpg', 'jpeg'].includes(extension) ? 1 : 0,
    heicImageCount: ['heic', 'heif'].includes(extension) ? 1 : 0,
    copyOnlyImageCount: ['png', 'gif', 'webp'].includes(extension) ? 1 : 0,
    videoCount: 0,
    videoBytes: 0
  };
};

const createVideoStats = (sizeBytes: number): MediaStats => ({
  imageCount: 0,
  imageBytes: 0,
  jpegImageCount: 0,
  heicImageCount: 0,
  copyOnlyImageCount: 0,
  videoCount: 1,
  videoBytes: sizeBytes
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
  jpegImageCount: base.jpegImageCount + extra.jpegImageCount,
  heicImageCount: base.heicImageCount + extra.heicImageCount,
  copyOnlyImageCount: base.copyOnlyImageCount + extra.copyOnlyImageCount,
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
      return createImageStats(node.name, node.sizeBytes);
    }

    if (kind === 'video') {
      return createVideoStats(node.sizeBytes);
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
      stats = mergeMediaStats(stats, createImageStats(file.name, file.size));
      continue;
    }

    if (kind === 'video') {
      stats = mergeMediaStats(stats, createVideoStats(file.size));
    }
  }

  return stats;
};

const estimateImageSavingsRatio = (quality: number) => {
  const normalizedQuality = clampQuality(quality);
  const linearRatio = 1.24 - 0.012 * normalizedQuality;

  return Math.min(0.56, Math.max(0.04, linearRatio));
};

const estimateVideoSavingsRatio = (presetName: string) => {
  const normalized = presetName.toLowerCase();

  if (normalized.includes('super hq')) {
    return 0.12;
  }

  if (normalized.includes('hq')) {
    return 0.16;
  }

  if (normalized.includes('very fast')) {
    return 0.3;
  }

  if (normalized.includes('fast')) {
    return 0.24;
  }

  return 0.2;
};

const isLikelyAbsolutePath = (value: string) => {
  if (!value) {
    return false;
  }

  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
};

export const CompressionPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceSelection, destinationSelection, isLoading: areFolderSelectionsLoading } = useFolderSelections();
  const compressionSessionState = useCompressionSessionState();
  const savedCompressionSettings = useMemo(() => loadCompressionSettings(), []);
  const [imagePreset, setImagePreset] = useState<ImagePresetId>(savedCompressionSettings.imagePreset);
  const [customQuality, setCustomQuality] = useState<number>(savedCompressionSettings.customQuality);
  const [videoPreset, setVideoPreset] = useState<string>(savedCompressionSettings.videoPreset);
  const [videoOutputFormatMode, setVideoOutputFormatMode] = useState<VideoOutputFormatMode>(savedCompressionSettings.videoOutputFormatMode);
  const [videoPresets, setVideoPresets] = useState<HandBrakePresetOption[]>([]);
  const [videoPresetsState, setVideoPresetsState] = useState<VideoPresetsState>({ status: 'idle', error: null });
  const [mediaStatsState, setMediaStatsState] = useState<MediaStatsState>({ status: 'idle', data: null, error: null });
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isStartingCompression, setIsStartingCompression] = useState(false);
  const [isEncoderSettingsLoading, setIsEncoderSettingsLoading] = useState(true);
  const [encoderSettings, setEncoderSettings] = useState<EncoderSettingsSnapshot>({
    imageToolCommand: '',
    videoToolCommand: '',
    imageMagickCommand: '',
    exifToolCommand: '',
    updatedAt: 0
  });
  const [progressData, setProgressData] = useState<{
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    total: number;
    completed: number;
    failed: number;
    currentlyProcessing: CompressionActiveItem[];
    processedItems: CompressionProgressItem[];
    totalCompress: number;
    totalCopy: number;
    completedCompress: number;
    completedCopy: number;
    failedCompress: number;
    failedCopy: number;
  } | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const completionTimerRef = useRef<number | null>(null);

  const activePreset = IMAGE_PRESETS.find((preset) => preset.id === imagePreset);
  const effectiveImageQuality = imagePreset === 'custom' ? customQuality : (activePreset?.quality ?? 80);
  const selectedImageProfileLabel = imagePreset === 'custom'
    ? t('compression.preset.custom')
    : activePreset
      ? t(activePreset.labelKey)
      : t('compression.preset.balanced');
  const selectedVideoProfileLabel = videoPreset;

  useEffect(() => {
    saveCompressionSettings({
      imagePreset,
      customQuality,
      videoPreset,
      videoOutputFormatMode
    });
  }, [imagePreset, customQuality, videoPreset, videoOutputFormatMode]);

  useEffect(() => {
    let isActive = true;

    loadEncoderSettings()
      .then((settings) => {
        if (isActive) {
          setEncoderSettings(settings);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsEncoderSettingsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const configuredVideoCommand = encoderSettings.videoToolCommand.trim();

    if (!configuredVideoCommand) {
      setVideoPresets([]);
      setVideoPresetsState({ status: 'idle', error: null });
      return;
    }

    setVideoPresetsState({ status: 'loading', error: null });

    void loadHandBrakePresetsRequest(configuredVideoCommand)
      .then((response) => {
        if (!isActive) {
          return;
        }

        setVideoPresets(response.presets);
        setVideoPresetsState({ status: 'ready', error: null });

        const availableNames = new Set(response.presets.map((preset) => preset.name));
        const fallbackPreset =
          response.presets.find((preset) => preset.name.toLowerCase() === 'fast 1080p30')?.name
          ?? response.defaultPreset
          ?? response.presets[0]?.name
          ?? 'Fast 1080p30';

        setVideoPreset((current) => (availableNames.has(current) ? current : fallbackPreset));
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setVideoPresets([]);
        setVideoPresetsState({
          status: 'error',
          error: error instanceof Error ? error.message : t('compression.presetsError')
        });
      });

    return () => {
      isActive = false;
    };
  }, [encoderSettings.videoToolCommand]);

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
          throw new Error(t('compression.noStatsError'));
        }

        if (!isActive) {
          return;
        }

        setMediaStatsState({ status: 'ready', data: nextStats, error: null });
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : t('compression.statsError');
        setMediaStatsState({ status: 'error', data: null, error: message });
      }
    };

    void loadMediaStats();

    return () => {
      isActive = false;
    };
  }, [sourceSelection?.updatedAt]);

  useEffect(() => {
    if (compressionSessionState.status !== 'running' || !compressionSessionState.backendSessionId) {
      return;
    }

    let isActive = true;

    const reconcileRunningState = async () => {
      try {
        const session = await getCompressionSessionRequest(compressionSessionState.backendSessionId as string);

        if (!isActive) {
          return;
        }

        const status = session.session.status;

        if (status === 'completed') {
          completeCompressionSession();
          setIsStartingCompression(false);
          return;
        }

        if (status === 'failed' || status === 'cancelled') {
          const errorDetails = extractCompressionErrorDetails(session.checkpoint?.payloadJson ?? null);
          const message = errorDetails.failedCount > 0
            ? t('compression.failedItemsSummary', { completed: errorDetails.completedCount, failed: errorDetails.failedCount })
            : t('compression.sessionEnded', { status });

          failCompressionSession(message);
          setBackendError(message);
          setIsStartingCompression(false);
        }
      } catch {
        if (!isActive) {
          return;
        }

        resetCompressionSession();
        setIsStartingCompression(false);
        setBackendError(t('compression.staleReset'));
      }
    };

    void reconcileRunningState();

    return () => {
      isActive = false;
    };
  }, [compressionSessionState.backendSessionId, compressionSessionState.status]);

  useEffect(() => {
    if (
      !compressionSessionState.backendSessionId ||
      (compressionSessionState.status !== 'completed' && compressionSessionState.status !== 'failed')
    ) {
      return;
    }

    let isActive = true;

    void getCompressionProgressRequest(compressionSessionState.backendSessionId)
      .then((progress) => {
        if (!isActive) {
          return;
        }

        setProgressData({
          status: progress.status as 'running' | 'completed' | 'failed' | 'cancelled',
          total: progress.total,
          completed: progress.completed,
          failed: progress.failed,
          currentlyProcessing: progress.currentlyProcessing,
          processedItems: progress.processedItems,
          totalCompress: progress.totalCompress,
          totalCopy: progress.totalCopy,
          completedCompress: progress.completedCompress,
          completedCopy: progress.completedCopy,
          failedCompress: progress.failedCompress,
          failedCopy: progress.failedCopy
        });
      })
      .catch(() => {
        // Completed local snapshots can outlive backend cleanup; leave the page usable.
      });

    return () => {
      isActive = false;
    };
  }, [compressionSessionState.backendSessionId, compressionSessionState.status]);

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
  const selectedStats = mediaStatsState.status === 'ready' ? mediaStatsState.data : createEmptyMediaStats();
  const estimatedTotalMediaCount = selectedStats.imageCount + selectedStats.videoCount;
  const hasSelectedJpegImages = selectedStats.jpegImageCount > 0;
  const hasSelectedHeicImages = selectedStats.heicImageCount > 0;
  const hasCopyOnlyImages = selectedStats.copyOnlyImageCount > 0;
  const hasSelectedVideos = selectedStats.videoCount > 0;
  const needsMozJpeg = hasSelectedJpegImages || hasSelectedHeicImages;
  const needsImageMagick = hasSelectedHeicImages;
  const needsHandBrake = hasSelectedVideos;
  const hasConfiguredMozJpeg = Boolean(encoderSettings.imageToolCommand.trim());
  const hasConfiguredImageMagick = Boolean(encoderSettings.imageMagickCommand.trim());
  const hasConfiguredHandBrake = Boolean(encoderSettings.videoToolCommand.trim());
  const hasAvailableVideoPresets = !needsHandBrake || videoPresets.length > 0;
  const hasRequiredTools =
    (!needsMozJpeg || hasConfiguredMozJpeg) &&
    (!needsImageMagick || hasConfiguredImageMagick) &&
    (!needsHandBrake || hasConfiguredHandBrake);
  const hasSelectedFolders = Boolean(sourceSelection && destinationSelection);
  const hasAbsolutePaths = isLikelyAbsolutePath(sourcePath) && isLikelyAbsolutePath(destinationPath);
  const isCompressionSetupLoading =
    areFolderSelectionsLoading ||
    isEncoderSettingsLoading ||
    (needsHandBrake && videoPresetsState.status === 'loading') ||
    mediaStatsState.status === 'loading';
  const canStartRealCompression =
    !isCompressionSetupLoading &&
    hasSelectedFolders &&
    hasAbsolutePaths &&
    mediaStatsState.status === 'ready' &&
    estimatedTotalMediaCount > 0 &&
    hasRequiredTools &&
    hasAvailableVideoPresets;
  const toolWarnings = [
    hasSelectedHeicImages && !encoderSettings.exifToolCommand.trim()
      ? t('compression.exifToolWarning')
      : null,
    hasCopyOnlyImages
      ? t('compression.copyOnlyImagesWarning', { count: selectedStats.copyOnlyImageCount })
      : null
  ].filter((message): message is string => Boolean(message));
  const compressionSetupMessage = (() => {
    if (isCompressionSetupLoading) {
      return t('compression.loadingSetup');
    }

    if (!hasSelectedFolders) {
      return t('compression.selectFolders');
    }

    if (mediaStatsState.status !== 'ready') {
      return t('compression.readingStats');
    }

    if (estimatedTotalMediaCount === 0) {
      return t('compression.noFiles');
    }

    if (needsMozJpeg && !hasConfiguredMozJpeg) {
      return t('compression.configureMozJpeg');
    }

    if (needsImageMagick && !hasConfiguredImageMagick) {
      return t('compression.configureImageMagick');
    }

    if (needsHandBrake && !hasConfiguredHandBrake) {
      return t('compression.configureHandBrakeTool');
    }

    if (!hasAbsolutePaths) {
      return t('compression.absolutePaths');
    }

    if (needsHandBrake && !hasAvailableVideoPresets) {
      return t('compression.loadPreset');
    }

    return null;
  })();
  const compressionSessionMessage = (() => {
    if (compressionSessionState.status === 'running') {
      return t('compression.running');
    }

    if (compressionSessionState.status === 'completed') {
      return t('compression.complete');
    }

    if (compressionSessionState.status === 'failed') {
      return null;
    }

    return compressionSetupMessage ?? t('compression.idle');
  })();
  const compressionSessionWarningMessage = toolWarnings.join(' ');
  const handleStartCompression = async () => {
    if (!destinationSelection || !sourceSelection || mediaStatsState.status === 'error') {
      return;
    }

    const latestEncoderSettings = await loadEncoderSettings();
    const latestHasConfiguredMozJpeg = Boolean(latestEncoderSettings.imageToolCommand.trim());
    const latestHasConfiguredImageMagick = Boolean(latestEncoderSettings.imageMagickCommand.trim());
    const latestHasConfiguredHandBrake = Boolean(latestEncoderSettings.videoToolCommand.trim());
    const latestHasRequiredTools =
      (!needsMozJpeg || latestHasConfiguredMozJpeg) &&
      (!needsImageMagick || latestHasConfiguredImageMagick) &&
      (!needsHandBrake || latestHasConfiguredHandBrake);

    setEncoderSettings(latestEncoderSettings);

    if (!canStartRealCompression || !latestHasRequiredTools) {
      setBackendError(
        !latestHasRequiredTools
          ? needsMozJpeg && !latestHasConfiguredMozJpeg
            ? t('compression.configureMozJpeg')
            : needsImageMagick && !latestHasConfiguredImageMagick
              ? t('compression.configureImageMagick')
              : needsHandBrake && !latestHasConfiguredHandBrake
                ? t('compression.configureHandBrakeTool')
                : t('compression.configureRequiredTools')
          : !hasRequiredTools
            ? compressionSetupMessage ?? t('compression.configureRequiredTools')
          : needsHandBrake && !hasAvailableVideoPresets
            ? t('compression.loadPreset')
          : t('compression.realPathRequired')
      );
      return;
    }

    setBackendError(null);
    setIsStartingCompression(true);
    setProgressData(null);
    setLogsExpanded(false);

    try {
      const started = await startCompressionSessionRequest({
        sourceDir: sourcePath,
        outputDir: destinationPath,
        imageQuality: effectiveImageQuality,
        imageProfileLabel: selectedImageProfileLabel,
        videoPresetLabel: selectedVideoProfileLabel,
        videoOutputFormatMode,
        imageToolCommand: latestEncoderSettings.imageToolCommand,
        videoToolCommand: latestEncoderSettings.videoToolCommand,
        imageMagickCommand: latestEncoderSettings.imageMagickCommand,
        exifToolCommand: latestEncoderSettings.exifToolCommand,
        selectionScope: loadSourceSelectionScope()
      });

      startCompressionSession({
        backendSessionId: started.session.id,
        imageProfileLabel: selectedImageProfileLabel,
        imageQuality: effectiveImageQuality,
        videoPresetLabel: selectedVideoProfileLabel,
        outputRootLabel: destinationPath
      });

      const poll = async () => {
        try {
          // First, try to get progress
          const progress = await getCompressionProgressRequest(started.session.id);
          
          setProgressData({
            status: progress.status as 'running' | 'completed' | 'failed' | 'cancelled',
            total: progress.total,
            completed: progress.completed,
            failed: progress.failed,
            currentlyProcessing: progress.currentlyProcessing,
            processedItems: progress.processedItems,
            totalCompress: progress.totalCompress,
            totalCopy: progress.totalCopy,
            completedCompress: progress.completedCompress,
            completedCopy: progress.completedCopy,
            failedCompress: progress.failedCompress,
            failedCopy: progress.failedCopy
          });

          const status = progress.status;

          if (status === 'completed') {
            completeCompressionSession();
            setIsStartingCompression(false);
            return;
          }

          if (status === 'failed' || status === 'cancelled') {
            // Fallback to session endpoint for error details
            const session = await getCompressionSessionRequest(started.session.id);
            const errorDetails = extractCompressionErrorDetails(session.checkpoint?.payloadJson ?? null);
            let errorMessage = t('compression.sessionEnded', { status });

            if (errorDetails.failedCount > 0) {
              errorMessage = t('compression.failedItemsSummary', { completed: errorDetails.completedCount, failed: errorDetails.failedCount });

              if (errorDetails.failedItems.length > 0) {
                const failedReasons = errorDetails.failedItems
                  .slice(0, 3)
                  .map((item) => {
                    const reason = item.error || t('compression.unknownError');
                    return `• ${item.source.split('/').pop() || item.source}: ${reason}`;
                  })
                  .join('\n');

                errorMessage += `\n\n${t('compression.failedItems')}\n${failedReasons}`;

                if (errorDetails.failedItems.length > 3) {
                  errorMessage += `\n${t('compression.moreFailed', { count: errorDetails.failedItems.length - 3 })}`;
                }
              }
            }

            failCompressionSession(errorMessage);
            setBackendError(errorMessage);
            setIsStartingCompression(false);
            return;
          }

          completionTimerRef.current = window.setTimeout(() => {
            void poll();
          }, 1000);
        } catch (error) {
          const message = error instanceof Error ? error.message : t('compression.pollError');
          console.error('[CompressionPage] polling error:', message);
          
          completionTimerRef.current = window.setTimeout(() => {
            void poll();
          }, 1000);
        }
      };

      await poll();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('compression.startError');
      failCompressionSession(message);
      setBackendError(message);
      setIsStartingCompression(false);
    }
  };

  const isCompressionRunning = compressionSessionState.status === 'running' || isStartingCompression;
  const isCompressionComplete = compressionSessionState.status === 'completed';

  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">{t('compression.title')}</h2>
        <p className="page-subtitle">{t('compression.subtitle')}</p>
      </div>

      <div className="page-card compression-session-card">
        <p className="page-section-title">{t('compression.session')}</p>
        <div className="compression-session-lines">
          <p className="page-summary-note compression-session-line">
            {t('compression.outputs', { destination: destinationPath ? ` (${destinationPath})` : '' })}
          </p>
          <p className="page-summary-note compression-session-line">
            {compressionSessionMessage}
          </p>
          <p className="page-summary-note compression-session-line compression-warning">
            {compressionSessionWarningMessage}
          </p>
        </div>
        {backendError && (
          <pre className="error compression-error-details">
            {backendError}
          </pre>
        )}
        {compressionSessionState.status === 'failed' && (
          <div className="compression-error-section">
            <p className="error">
              {t('compression.failed', { message: compressionSessionState.errorMessage ?? t('compression.failedFallback') })}
            </p>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => resetCompressionSession()}
            >
              ↻ {t('compression.tryAgain')}
            </button>
          </div>
        )}
      </div>

      {(isCompressionRunning || progressData) && progressData && (
        <div className="page-card compression-progress-card">
          <p className="page-section-title">{t('compression.progressTitle')}</p>
          {progressData.total === 0 && estimatedTotalMediaCount > 0 && (
            <p className="page-summary-note">
              {t('compression.preparingFiles', { count: estimatedTotalMediaCount })}
            </p>
          )}
          
          <div className="compression-progress-stats">
            <div className="progress-stat">
              <span className="progress-label">{t('compression.total')}</span>
              <span className="progress-value">{progressData.total > 0 ? progressData.total : estimatedTotalMediaCount} {t('compression.files')}</span>
            </div>
            <div className="progress-stat">
              <span className="progress-label">{t('compression.completed')}</span>
              <span className="progress-value" style={{ color: '#10b981' }}>{progressData.completed} / {progressData.total > 0 ? progressData.total : estimatedTotalMediaCount}</span>
            </div>
            <div className="progress-stat">
              <span className="progress-label">{t('compression.failedLabel')}</span>
              <span className="progress-value" style={{ color: progressData.failed > 0 ? '#ef4444' : '#6b7280' }}>{progressData.failed}</span>
            </div>
          </div>

          <p className="page-summary-note">
            {t('compression.operationBreakdown', {
              compressed: progressData.completedCompress,
              totalCompress: progressData.totalCompress,
              copied: progressData.completedCopy,
              totalCopy: progressData.totalCopy
            })}
          </p>

          <div className="compression-progress-bar">
            <div 
              className="compression-progress-fill"
              style={{ width: (progressData.total > 0 ? progressData.total : estimatedTotalMediaCount) > 0 ? `${(progressData.completed / (progressData.total > 0 ? progressData.total : estimatedTotalMediaCount)) * 100}%` : '0%' }}
            />
          </div>
          
          {progressData.total === 0 ? (
            progressData.status === 'completed' ? (
              <p className="page-summary-note" style={{ color: '#ef4444', fontWeight: 500 }}>
                ⚠️ {t('compression.noFiles')}
              </p>
            ) : (
              <p className="page-summary-note">
                {t('compression.gatheringFiles', {
                  detected: estimatedTotalMediaCount > 0 ? t('compression.detected', { count: estimatedTotalMediaCount }) : ''
                })}
              </p>
            )
          ) : (
            <p className="page-summary-note">
              {t('compression.itemsProcessed', { completed: progressData.completed, total: progressData.total })}
            </p>
          )}

          {progressData.status === 'running' && (
            <div className="compression-currently-processing">
              <p className="compression-processing-label">{t('compression.processing')}</p>
              <div className="compression-processing-list">
                {progressData.currentlyProcessing.length > 0 ? (
                  progressData.currentlyProcessing.slice(0, 2).map((item) => (
                    <div key={item.id} className="compression-processing-item">
                      {t(item.operation === 'compress' ? 'compression.compressingItem' : 'compression.copyingItem', {
                        name: getFileLabel(item.sourcePath)
                      })}
                      {item.startedAt ? ` - ${formatDuration(Date.now() - item.startedAt)}` : ''}
                    </div>
                  ))
                ) : (
                  <div className="compression-processing-item">
                    {progressData.completed + progressData.failed >= progressData.total
                      ? t('compression.finalizing')
                      : t('compression.preparingNextItem')}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="compression-logs-section">
            <button
              className="compression-logs-toggle"
              type="button"
              onClick={() => setLogsExpanded(!logsExpanded)}
            >
              {t('compression.detailedLogs', { icon: logsExpanded ? '▼' : '▶', count: progressData.completed + progressData.failed })}
            </button>
            
            {logsExpanded && (
              <div className="compression-logs-list">
                {progressData.processedItems.length > 0 ? (
                  progressData.processedItems.map((item) => (
                    <div key={item.id} className={`compression-log-item compression-log-${item.status}`}>
                      <span className="compression-log-status">
                        {item.status === 'completed' ? '✓' : '✗'}
                      </span>
                      <span className="compression-log-name">
                        {t(item.skipped && item.operation === 'copy'
                          ? 'compression.logCopySkipped'
                          : item.operation === 'compress'
                            ? 'compression.logCompressed'
                            : 'compression.logCopied', {
                          name: getFileLabel(item.sourcePath)
                        })}
                        {typeof item.durationMs === 'number' ? ` - ${formatDuration(item.durationMs)}` : ''}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="page-summary-note">{t('compression.noItemsProcessed')}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="page-grid-2">
        <div className="page-card">
          <h3 className="page-section-title">📸 {t('compression.imageTitle')}</h3>
          <p className="page-summary-note">{t('compression.imageNote')}</p>

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
                  <strong>{t(preset.labelKey)}</strong> {t('compression.qualityText', { quality: preset.quality, note: t(preset.noteKey) })}
                </span>
              </label>
            ))}

            <label className="page-option">
              <input type="radio" name="image" checked={imagePreset === 'custom'} onChange={() => setImagePreset('custom')} />
              <span className="page-option-label">
                <strong>{t('compression.preset.custom')}</strong> {t('compression.customQualityText')}
              </span>
            </label>

            {imagePreset === 'custom' && (
              <label className="compression-custom-quality" htmlFor="image-quality-custom">
                <span className="page-option-label">
                  <strong>{t('compression.customQuality')}</strong> {t('compression.customQualityRange')}
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
                <span className="page-summary-note">{t('compression.exampleCommand', { quality: customQuality })}</span>
              </label>
            )}
          </div>
        </div>

        <div className="page-card">
          <h3 className="page-section-title">🎬 {t('compression.videoTitle')}</h3>
          <p className="page-summary-note">{t('compression.videoNote')}</p>

          <div className="page-option-list">
            {videoPresetsState.status === 'idle' && (
              <p className="page-summary-note">{t('compression.configureHandBrake')}</p>
            )}

            {videoPresetsState.status === 'loading' && (
              <p className="page-summary-note">{t('compression.loadingPresets')}</p>
            )}

            {videoPresetsState.status === 'error' && (
              <p className="error">{videoPresetsState.error}</p>
            )}

            {videoPresetsState.status === 'ready' && hasAvailableVideoPresets && (
              <>
                <label className="compression-video-preset" htmlFor="video-preset-select">
                  <span className="page-option-label">
                    <strong>{t('compression.presetLabel')}</strong> {t('compression.presetHelp')}
                  </span>
                  <select
                    id="video-preset-select"
                    className="compression-preset-select"
                    value={videoPreset}
                    onChange={(event) => setVideoPreset(event.target.value)}
                  >
                    {Object.entries(
                      videoPresets.reduce<Record<string, HandBrakePresetOption[]>>((groups, preset) => {
                        if (!groups[preset.category]) {
                          groups[preset.category] = [];
                        }

                        groups[preset.category].push(preset);
                        return groups;
                      }, {})
                    ).map(([category, presets]) => (
                      <optgroup key={category} label={category}>
                        {presets.map((preset) => (
                          <option key={`${preset.category}:${preset.name}`} value={preset.name}>
                            {preset.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <div className="page-option-list" role="radiogroup" aria-label={t('compression.videoOutputFormatLabel')}>
                  <label className="page-option">
                    <input
                      type="radio"
                      name="video-output-format"
                      checked={videoOutputFormatMode === 'preserve'}
                      onChange={() => setVideoOutputFormatMode('preserve')}
                    />
                    <span className="page-option-label">
                      <strong>{t('compression.videoOutputPreserve')}</strong> {t('compression.videoOutputPreserveHelp')}
                    </span>
                  </label>

                  <label className="page-option">
                    <input
                      type="radio"
                      name="video-output-format"
                      checked={videoOutputFormatMode === 'mp4'}
                      onChange={() => setVideoOutputFormatMode('mp4')}
                    />
                    <span className="page-option-label">
                      <strong>{t('compression.videoOutputMp4')}</strong> {t('compression.videoOutputMp4Help')}
                    </span>
                  </label>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="page-card">
        <p className="page-summary-label">{t('compression.summary')}</p>
        {mediaStatsState.status === 'loading' && <p className="page-summary-note">{t('compression.readingStats')}</p>}
        {mediaStatsState.status === 'error' && <p className="error">{mediaStatsState.error}</p>}
        {mediaStatsState.status === 'idle' && <p className="page-summary-note">{t('compression.selectSourceForMetrics')}</p>}
        <div className="page-summary">
          {mediaStatsState.status === 'ready' && (
            <>
              <p>
                📸 {t('compression.imageSummary', {
                  count: mediaStatsState.data.imageCount,
                  profile: selectedImageProfileLabel,
                  quality: effectiveImageQuality,
                  saved: formatBytes(imageEstimatedSavedBytes)
                })}
              </p>
              <p>
                🎬 {t('compression.videoSummary', {
                  count: mediaStatsState.data.videoCount,
                  profile: selectedVideoProfileLabel,
                  saved: formatBytes(videoEstimatedSavedBytes)
                })}
              </p>
              <p className="page-summary-note">
                {t('compression.estimatesNote')}
              </p>
              {hasCopyOnlyImages && (
                <p className="page-summary-note">
                  {t('compression.copyOnlyImagesSummary', { count: selectedStats.copyOnlyImageCount })}
                </p>
              )}
              {hasSelectedHeicImages && (
                <p className="page-summary-note">
                  {t('compression.heicSummary', { count: selectedStats.heicImageCount })}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button" onClick={handleBack}>
          {t('compression.back')}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void handleStartCompression()}
          disabled={isCompressionRunning || isCompressionComplete || !canStartRealCompression}
        >
          {isCompressionRunning
            ? t('compression.runningButton')
            : isCompressionComplete
              ? t('compression.completedButton')
              : isCompressionSetupLoading
                ? t('compression.loadingSetupButton')
                : t('compression.startButton')}
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => navigate('/grouping', { state: { from: '/compression' } })} disabled={!isCompressionComplete}>
          {t('compression.continueGrouping')}
        </button>
      </div>
    </div>
  );
};

export default CompressionPage;
