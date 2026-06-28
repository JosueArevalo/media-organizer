import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { InfoTooltip } from '../components/InfoTooltip';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useExportJobState } from '../hooks/useExportJobState';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation, type TranslationKey } from '../i18n';
import { notifyCompletion } from '../services/completion-notification.service';
import { resetExportJobSnapshot } from '../services/export-job.store';
import { isGroupingReadOnlyForExport } from '../services/workflow-locks';
import {
  completeGroupingSession,
  failGroupingSession,
  setGroupingActiveView,
  startGroupingSession,
  type GroupingActiveView
} from '../services/grouping-job.store';
import {
  applyGroupingWorkspaceRequest,
  assignGroupingItemsRequest,
  buildGroupingMediaUrl,
  buildGroupingPreviewUrl,
  buildGroupingThumbnailUrl,
  buildGroupingVideoPosterUrl,
  createGroupingFolderFromTemplateRequest,
  createGroupingFolderRequest,
  createGroupingTemplateRequest,
  createGroupingWorkspaceRequest,
  deleteGroupingFolderRequest,
  deleteGroupingItemsRequest,
  deleteGroupingTemplateRequest,
  getGroupingWorkspaceRequest,
  reorganizeGroupingWorkspaceRequest,
  renameGroupingFolderRequest,
  renamePreservedGroupingFolderScopeRequest,
  resetGroupingWorkspaceRequest,
  updateGroupingTemplateRequest,
  type GroupingFolderTemplate,
  type GroupingSingleDateHandling,
  type GroupingSourceFolderMode,
  type GroupingStrategy,
  type GroupingWorkspace,
  type GroupingWorkspaceFolder,
  type GroupingWorkspaceItem,
  type ExecutionVerification
} from '../services/grouping.service';
import { generateVideoPoster, getCachedVideoPoster } from '../services/video-poster.service';

const formatBytes = (value: number) => {
  if (value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;

  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const sanitizeGroupingFolderLabel = (label: string) => {
  const sanitized = label
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return sanitized || 'Sin nombre';
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const getSelectedDragPayload = (item: GroupingWorkspaceItem, selectedIds: Set<string>) => {
  if (selectedIds.has(item.id)) {
    return Array.from(selectedIds);
  }

  return [item.id];
};

const PRESERVED_FOLDER_PREFIX = '__preserved__:';

type PreservedFolderScope = {
  path: string;
  label: string;
  activeLabel: string;
  itemCount: number;
};

const getPreservedFolderActiveLabel = (path: string) => `${PRESERVED_FOLDER_PREFIX}${path}`;

const getActivePreservedFolderPath = (activeFolderLabel: string) =>
  activeFolderLabel.startsWith(PRESERVED_FOLDER_PREFIX) ? activeFolderLabel.slice(PRESERVED_FOLDER_PREFIX.length) : null;

const getRelativePreservedFolderPath = (scopePath: string, sourceRootPath: string) => {
  const normalizedScope = formatPath(scopePath);
  const normalizedSourceRoot = formatPath(sourceRootPath);
  const normalizedRootName = formatPath(getPathName(sourceRootPath));

  if (normalizedScope === normalizedSourceRoot || normalizedScope === normalizedRootName) {
    return '';
  }

  if (normalizedScope.startsWith(`${normalizedSourceRoot}/`)) {
    return normalizedScope.slice(normalizedSourceRoot.length + 1);
  }

  return normalizedScope.startsWith(`${normalizedRootName}/`)
    ? normalizedScope.slice(normalizedRootName.length + 1)
    : normalizedScope;
};

const isItemInPreservedFolderScope = (item: GroupingWorkspaceItem, scopePath: string, sourceRootPath: string) => {
  if (!item.preservedStructure) {
    return false;
  }

  const relativeScopePath = getRelativePreservedFolderPath(scopePath, sourceRootPath);
  const itemDirectory = getDirectoryPath(item.relativePath);

  return (
    relativeScopePath === '' ||
    itemDirectory === relativeScopePath ||
    itemDirectory.startsWith(`${relativeScopePath}/`)
  );
};

const getItemsForFolderScope = (items: GroupingWorkspaceItem[], activeFolderLabel: string, sourceRootPath: string) =>
  items.filter((item) => {
    if (activeFolderLabel === '__all__') {
      return true;
    }

    const preservedFolderPath = getActivePreservedFolderPath(activeFolderLabel);
    if (preservedFolderPath) {
      return isItemInPreservedFolderScope(item, preservedFolderPath, sourceRootPath);
    }

    if (activeFolderLabel === '__unassigned__') {
      return !item.preservedStructure && !item.targetGroupLabel;
    }

    return item.targetGroupLabel === activeFolderLabel;
  });

const getNextPreviewItemId = (
  items: GroupingWorkspaceItem[],
  activeFolderLabel: string,
  sourceRootPath: string,
  previousIndex: number,
  preferredItemId?: string
) => {
  const scopedItems = getItemsForFolderScope(items, activeFolderLabel, sourceRootPath);

  if (preferredItemId && scopedItems.some((item) => item.id === preferredItemId)) {
    return preferredItemId;
  }

  if (scopedItems.length === 0) {
    return null;
  }

  return scopedItems[Math.min(Math.max(previousIndex, 0), scopedItems.length - 1)].id;
};

type GroupingView = GroupingActiveView;

const areSortedValuesEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};

const getSortedSetValues = (values: Set<string>) =>
  Array.from(values).sort((left, right) => left.localeCompare(right));

const getSortedValues = (values: string[]) =>
  [...values].sort((left, right) => left.localeCompare(right));

const DEFAULT_SINGLE_DATE_HANDLING: GroupingSingleDateHandling = 'year-unique';
const DEFAULT_SOURCE_FOLDER_MODE: GroupingSourceFolderMode = 'relative-path';
const DATE_EXAMPLE_FILES = [
  'IMG_20120915_153738.jpg',
  'IMG_20120915_162710.jpg',
  'IMG_20120918_092158.jpg'
] as const;
const SINGLE_DATE_EXAMPLE_DESTINATIONS: Record<GroupingSingleDateHandling, string> = {
  'daily-event': '2012.09.18 - Event',
  'year-unique': '2012 - Unique',
  'keep-original': 'Camera'
};
const SOURCE_FOLDER_EXAMPLE_FILE = 'IMG_20120915_153738.jpg';
const GROUPING_GRID_INITIAL_LIMIT = 160;
const GROUPING_GRID_INCREMENT = 160;
const VERIFICATION_STATUS_KEYS: Record<ExecutionVerification['status'], TranslationKey> = {
  ok: 'verification.status.ok',
  mismatch: 'verification.status.mismatch',
  not_verified: 'verification.status.not_verified'
};

type GroupingDirectoryNode = {
  name: string;
  path: string;
  depth: number;
  fileCount: number;
  sizeBytes: number;
  children: GroupingDirectoryNode[];
};

type GroupingDirectoryRow = GroupingDirectoryNode & {
  isExpanded: boolean;
  hasChildren: boolean;
  isPreserved: boolean;
  isPreservedOverride: boolean;
  isReorganizedOverride: boolean;
};

type Point = {
  x: number;
  y: number;
};

type MarqueeSelection = {
  anchor: Point;
  current: Point;
  initialSelectedIds: Set<string>;
  isAdditive: boolean;
};

type GroupingFormDialogState =
  | { kind: 'create-folder'; name: string }
  | { kind: 'rename-folder'; folder: GroupingWorkspaceFolder; name: string }
  | { kind: 'rename-preserved-folder'; scopePath: string; currentLabel: string; name: string }
  | { kind: 'create-template'; name: string; pattern: string; patternTouched: boolean };

type GroupingFormDialogProps = {
  title: string;
  submitLabel: string;
  cancelLabel: string;
  isSubmitting: boolean;
  submitDisabled: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
};

const GroupingFormDialog = ({
  title,
  submitLabel,
  cancelLabel,
  isSubmitting,
  submitDisabled,
  error,
  onSubmit,
  onCancel,
  children
}: GroupingFormDialogProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onCancel]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitDisabled && !isSubmitting) onSubmit();
  };

  return (
    <div className="grouping-modal grouping-form-dialog" role="dialog" aria-modal="true" aria-labelledby="grouping-form-dialog-title">
      <form className="grouping-form-dialog-panel" onSubmit={handleSubmit}>
        <div className="grouping-modal-head">
          <strong id="grouping-form-dialog-title">{title}</strong>
        </div>
        <div className="grouping-form-dialog-fields">{children}</div>
        {error && <p className="grouping-form-dialog-error" role="alert">{error}</p>}
        <div className="grouping-form-dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={isSubmitting}>{cancelLabel}</button>
          <button className="btn btn-primary" type="submit" disabled={submitDisabled || isSubmitting}>{submitLabel}</button>
        </div>
      </form>
    </div>
  );
};

const formatPath = (path: string) => path.split('\\').join('/');

const getPathName = (path: string) => formatPath(path).split('/').filter(Boolean).pop() ?? path;

const getDirectoryPath = (relativePath: string) => {
  const normalized = formatPath(relativePath);
  const segments = normalized.split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
};

const getFileExtensionLabel = (fileName: string, fallback: string) => {
  const extension = fileName.split('.').pop()?.trim();
  return extension ? extension.toUpperCase() : fallback;
};

type GroupingMediaPreviewProps = {
  item: GroupingWorkspaceItem;
  imageThumbnailUrl: string;
  videoPosterSourceUrl: string;
  videoPosterCacheKey: string;
  hasPreviewFailed: boolean;
  previewUnavailableLabel: string;
  onPreviewFailed: (itemId: string) => void;
  onOpenPreview: () => void;
};

const GroupingMediaPreview = ({
  item,
  imageThumbnailUrl,
  videoPosterSourceUrl,
  videoPosterCacheKey,
  hasPreviewFailed,
  previewUnavailableLabel,
  onPreviewFailed,
  onOpenPreview
}: GroupingMediaPreviewProps) => {
  const previewRef = useRef<HTMLButtonElement | null>(null);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(() => getCachedVideoPoster(videoPosterCacheKey));
  const formatLabel = getFileExtensionLabel(item.fileName, item.mediaType === 'video' ? 'VIDEO' : 'FILE');

  useEffect(() => {
    setVideoPosterUrl(getCachedVideoPoster(videoPosterCacheKey));
  }, [videoPosterCacheKey]);

  useEffect(() => {
    if (item.mediaType !== 'video' || hasPreviewFailed) {
      return;
    }

    const element = previewRef.current;
    if (!element) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const loadPoster = () => {
      void generateVideoPoster(videoPosterCacheKey, videoPosterSourceUrl, controller.signal)
        .then((posterUrl) => {
          if (!cancelled) setVideoPosterUrl(posterUrl);
        })
        .catch(() => {
          if (!cancelled) onPreviewFailed(item.id);
        });
    };

    if (typeof IntersectionObserver === 'undefined') {
      loadPoster();
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadPoster();
          observer.disconnect();
        }
      },
      { rootMargin: '320px 0px' }
    );

    observer.observe(element);

    return () => {
      cancelled = true;
      controller.abort();
      observer.disconnect();
    };
  }, [hasPreviewFailed, item.id, item.mediaType, onPreviewFailed, videoPosterCacheKey, videoPosterSourceUrl]);

  return (
    <button ref={previewRef} className="grouping-media-preview" type="button" onDoubleClick={onOpenPreview}>
      {item.mediaType === 'image' && !hasPreviewFailed ? (
        <img src={imageThumbnailUrl} alt={item.fileName} loading="lazy" onError={() => onPreviewFailed(item.id)} />
      ) : item.mediaType === 'image' ? (
        <span>{previewUnavailableLabel}</span>
      ) : item.mediaType === 'video' && !hasPreviewFailed ? (
        <>
          {videoPosterUrl ? (
            <img src={videoPosterUrl} alt={item.fileName} loading="lazy" onError={() => onPreviewFailed(item.id)} />
          ) : (
            <span>{formatLabel}</span>
          )}
          <span className="grouping-media-type-badge">{formatLabel}</span>
        </>
      ) : item.mediaType === 'video' ? (
        <>
          <span>{formatLabel}</span>
          <span className="grouping-media-type-badge">{formatLabel}</span>
        </>
      ) : (
        <span>{formatLabel}</span>
      )}
    </button>
  );
};

const ensureDirectoryNode = (root: GroupingDirectoryNode, directoryPath: string) => {
  const segments = directoryPath.split('/').filter(Boolean);
  let current = root;
  let currentPath = root.path;

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    let child = current.children.find((candidate) => candidate.name === segment);

    if (!child) {
      child = {
        name: segment,
        path: currentPath,
        depth: current.depth + 1,
        fileCount: 0,
        sizeBytes: 0,
        children: []
      };
      current.children.push(child);
      current.children.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    }

    current = child;
  }

  return current;
};

const buildGroupingDirectoryTree = (workspace: GroupingWorkspace): GroupingDirectoryNode => {
  const root: GroupingDirectoryNode = {
    name: workspace.sourceDir.split(/[\\/]/).filter(Boolean).pop() ?? 'Source',
    path: workspace.sourceDir.split(/[\\/]/).filter(Boolean).pop() ?? 'Source',
    depth: 0,
    fileCount: 0,
    sizeBytes: 0,
    children: []
  };

  for (const item of workspace.items) {
    root.fileCount += 1;
    root.sizeBytes += item.sizeBytes;
    const directoryPath = getDirectoryPath(item.relativePath);
    const directory = directoryPath ? ensureDirectoryNode(root, directoryPath) : null;

    if (directory) {
      directory.fileCount += 1;
      directory.sizeBytes += item.sizeBytes;
    }

    const segments = directoryPath.split('/').filter(Boolean);
    let currentPath = root.path;
    let current = root;

    for (const segment of segments) {
      currentPath = `${currentPath}/${segment}`;
      current = current.children.find((candidate) => candidate.path === currentPath) ?? current;
      if (current !== directory) {
        current.fileCount += 1;
        current.sizeBytes += item.sizeBytes;
      }
    }
  }

  return root;
};

const getStructureState = (path: string, preservedDirectories: Set<string>, reorganizedDirectories: Set<string>) => {
  const segments = formatPath(path).split('/').filter(Boolean);
  let currentPath = '';
  let isPreserved = false;

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;

    if (preservedDirectories.has(currentPath)) {
      isPreserved = true;
    }

    if (reorganizedDirectories.has(currentPath)) {
      isPreserved = false;
    }
  }

  return {
    isPreserved,
    isPreservedOverride: preservedDirectories.has(path),
    isReorganizedOverride: reorganizedDirectories.has(path)
  };
};

const flattenDirectoryTree = (
  node: GroupingDirectoryNode,
  expandedDirectories: Set<string>,
  preservedDirectories: Set<string>,
  reorganizedDirectories: Set<string>,
  rows: GroupingDirectoryRow[] = []
) => {
  const structureState = getStructureState(node.path, preservedDirectories, reorganizedDirectories);
  const isExpanded = expandedDirectories.has(node.path);
  rows.push({
    ...node,
    isExpanded,
    hasChildren: node.children.length > 0,
    ...structureState
  });

  if (isExpanded) {
    for (const child of node.children) {
      flattenDirectoryTree(child, expandedDirectories, preservedDirectories, reorganizedDirectories, rows);
    }
  }

  return rows;
};

const getNormalizedRect = (start: Point, end: Point) => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y)
});

const rectsIntersect = (left: DOMRect, right: DOMRect) =>
  left.left < right.right &&
  left.right > right.left &&
  left.top < right.bottom &&
  left.bottom > right.top;

export const GroupingPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const groupingMainRef = useRef<HTMLElement | null>(null);
  const modalVideoRef = useRef<HTMLVideoElement | null>(null);
  const { sourceSelection, destinationSelection, isLoading: isLoadingFolderSelections } = useFolderSelections();
  const compressionSessionState = useCompressionSessionState();
  const groupingSessionState = useGroupingSessionState();
  const [workspace, setWorkspace] = useState<GroupingWorkspace | null>(null);
  const [activeFolderLabel, setActiveFolderLabel] = useState<string>('__all__');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isReorganizing, setIsReorganizing] = useState(false);
  const [view, setView] = useState<GroupingView>('setup');
  const [selectedStrategy, setSelectedStrategy] = useState<GroupingStrategy | null>('date');
  const [singleDateHandling, setSingleDateHandling] = useState<GroupingSingleDateHandling>(DEFAULT_SINGLE_DATE_HANDLING);
  const [sourceFolderMode, setSourceFolderMode] = useState<GroupingSourceFolderMode>(DEFAULT_SOURCE_FOLDER_MODE);
  const [preservedDirectories, setPreservedDirectories] = useState<Set<string>>(new Set());
  const [reorganizedDirectories, setReorganizedDirectories] = useState<Set<string>>(new Set());
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(new Set());
  const [failedThumbnailIds, setFailedThumbnailIds] = useState<Set<string>>(new Set());
  const [formDialog, setFormDialog] = useState<GroupingFormDialogState | null>(null);
  const [isSubmittingFormDialog, setIsSubmittingFormDialog] = useState(false);
  const [renderedItemLimit, setRenderedItemLimit] = useState(GROUPING_GRID_INITIAL_LIMIT);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelection | null>(null);
  const [verification, setVerification] = useState<ExecutionVerification | null>(null);

  const sourcePath = sourceSelection?.path ?? '';
  const destinationPath = destinationSelection?.path ?? '';
  const hasWorkspacePrerequisites = Boolean(sourcePath && destinationPath && compressionSessionState.backendSessionId);
  const canOpenWorkspace =
    hasWorkspacePrerequisites &&
    (compressionSessionState.status === 'completed' || compressionSessionState.status === 'failed');
  const isGroupingCompleted = groupingSessionState.status === 'completed';
  const isWaitingForWorkspacePrerequisites =
    isLoadingFolderSelections || (hasWorkspacePrerequisites && compressionSessionState.status === 'running');
  const sourceRootPath = workspace?.sourceDir ?? 'Source';
  const exportContext = {
    groupingSessionId: groupingSessionState.backendSessionId,
    sourceRoot: workspace?.outputDir ?? groupingSessionState.outputRootLabel
  };
  const networkExportJobState = useExportJobState('network-folder', exportContext);
  const googlePhotosExportJobState = useExportJobState('google-photos', exportContext);
  const isExportActive = isGroupingReadOnlyForExport([networkExportJobState, googlePhotosExportJobState]);
  const canMutateGrouping = !isExportActive;

  const refreshWorkspace = useCallback(
    async (sessionId: string) => {
      const nextWorkspace = await getGroupingWorkspaceRequest(sessionId);
      setWorkspace(nextWorkspace);
      setBackendError(null);
      return nextWorkspace;
    },
    []
  );

  const changeGroupingView = useCallback((nextView: GroupingView) => {
    setView(nextView);
    setGroupingActiveView(nextView);
  }, []);

  const markGroupingDraftChanged = useCallback(() => {
    if (networkExportJobState.status === 'completed' || networkExportJobState.status === 'failed') {
      resetExportJobSnapshot('network-folder');
    }

    if (googlePhotosExportJobState.status === 'completed' || googlePhotosExportJobState.status === 'failed') {
      resetExportJobSnapshot('google-photos');
    }

    if (workspace) {
      startGroupingSession({
        backendSessionId: workspace.sessionId,
        outputRootLabel: workspace.outputDir
      });
    }
  }, [
    googlePhotosExportJobState.status,
    networkExportJobState.status,
    workspace
  ]);

  useEffect(() => {
    let isActive = true;

    const load = async () => {
      if (!canOpenWorkspace || !compressionSessionState.backendSessionId) {
        return;
      }

      setIsLoading(true);

      try {
        const nextWorkspace = groupingSessionState.backendSessionId
          ? await getGroupingWorkspaceRequest(groupingSessionState.backendSessionId)
          : await createGroupingWorkspaceRequest({
              sourceDir: sourcePath,
              outputDir: destinationPath,
              compressionSessionId: compressionSessionState.backendSessionId
            });

        if (!isActive) {
          return;
        }

        setWorkspace(nextWorkspace);
        setSelectedStrategy(nextWorkspace.strategy ?? 'date');
        setSingleDateHandling(nextWorkspace.dateOptions.singleDateHandling);
        setSourceFolderMode(nextWorkspace.sourceFolderOptions.mode);
        setPreservedDirectories(new Set(nextWorkspace.preservedDirectories));
        setReorganizedDirectories(new Set(nextWorkspace.reorganizedDirectories));
        setExpandedDirectories(new Set([nextWorkspace.sourceDir.split(/[\\/]/).filter(Boolean).pop() ?? 'Source']));
        changeGroupingView(
          groupingSessionState.activeView ?? (nextWorkspace.folders.length > 0 || nextWorkspace.strategy ? 'review' : 'setup')
        );
        setBackendError(null);

        if (!groupingSessionState.backendSessionId) {
          startGroupingSession({
            backendSessionId: nextWorkspace.sessionId,
            activeView: groupingSessionState.activeView ?? (nextWorkspace.folders.length > 0 || nextWorkspace.strategy ? 'review' : 'setup'),
            outputRootLabel: nextWorkspace.outputDir
          });
        }
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : t('grouping.openError');
        setBackendError(message);
        failGroupingSession(message);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isActive = false;
    };
  }, [
    canOpenWorkspace,
    compressionSessionState.backendSessionId,
    compressionSessionState.status,
    destinationPath,
    changeGroupingView,
    groupingSessionState.backendSessionId,
    sourcePath
  ]);

  useEffect(() => {
    if (!isGroupingCompleted) {
      return;
    }

    setSelectedIds(new Set());
    changeGroupingView('review');
  }, [changeGroupingView, isGroupingCompleted]);

  useEffect(() => {
    setRenderedItemLimit(GROUPING_GRID_INITIAL_LIMIT);
  }, [activeFolderLabel, searchTerm, workspace?.sessionId]);

  const preservedFolderScopes = useMemo<PreservedFolderScope[]>(() => {
    if (!workspace) {
      return [];
    }

    return workspace.preservedDirectories
      .map((path) => ({
        path,
        label: getPathName(path),
        activeLabel: getPreservedFolderActiveLabel(path),
        itemCount: workspace.items.filter((item) => isItemInPreservedFolderScope(item, path, sourceRootPath)).length
      }))
      .filter((scope) => scope.itemCount > 0)
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
  }, [sourceRootPath, workspace]);

  const activePreservedFolder = useMemo(
    () => preservedFolderScopes.find((scope) => scope.activeLabel === activeFolderLabel) ?? null,
    [activeFolderLabel, preservedFolderScopes]
  );

  const activeFolder = useMemo(() => {
    if (!workspace || activeFolderLabel === '__all__' || activePreservedFolder) {
      return null;
    }

    return workspace.folders.find((folder) => folder.label === activeFolderLabel) ?? null;
  }, [activeFolderLabel, activePreservedFolder, workspace]);

  const resolveNextActiveFolderLabel = useCallback((nextWorkspace: GroupingWorkspace, preferredLabel: string) => {
    if (preferredLabel === '__all__') {
      return '__all__';
    }

    if (preferredLabel === '__unassigned__') {
      return nextWorkspace.items.some((item) => !item.preservedStructure && !item.targetGroupLabel)
        ? '__unassigned__'
        : '__all__';
    }

    if (getActivePreservedFolderPath(preferredLabel)) {
      return getItemsForFolderScope(nextWorkspace.items, preferredLabel, nextWorkspace.sourceDir).length > 0
        ? preferredLabel
        : '__all__';
    }

    return nextWorkspace.folders.some((folder) => folder.label === preferredLabel) ? preferredLabel : '__all__';
  }, []);

  const folderScopeItems = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return getItemsForFolderScope(workspace.items, activeFolderLabel, sourceRootPath);
  }, [activeFolderLabel, sourceRootPath, workspace]);

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return folderScopeItems.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.fileName.toLowerCase().includes(normalizedSearch) ||
        item.relativePath.toLowerCase().includes(normalizedSearch);

      return matchesSearch;
    });
  }, [folderScopeItems, searchTerm]);

  const renderedItems = useMemo(
    () => visibleItems.slice(0, renderedItemLimit),
    [renderedItemLimit, visibleItems]
  );

  const canRenderMoreItems = renderedItems.length < visibleItems.length;

  const previewItem = useMemo(() => {
    if (!workspace || !previewItemId) {
      return null;
    }

    return workspace.items.find((item) => item.id === previewItemId) ?? null;
  }, [previewItemId, workspace]);

  const previewIndex = previewItem ? folderScopeItems.findIndex((item) => item.id === previewItem.id) : -1;
  const canShowPreviousPreview = previewIndex > 0;
  const canShowNextPreview = previewIndex >= 0 && previewIndex < folderScopeItems.length - 1;
  const marqueeRect = marqueeSelection ? getNormalizedRect(marqueeSelection.anchor, marqueeSelection.current) : null;

  const selectedItems = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return workspace.items.filter((item) => selectedIds.has(item.id));
  }, [selectedIds, workspace]);

  const directoryTree = useMemo(() => (workspace ? buildGroupingDirectoryTree(workspace) : null), [workspace]);

  const directoryRows = useMemo(() => {
    if (!directoryTree) {
      return [];
    }

    return flattenDirectoryTree(directoryTree, expandedDirectories, preservedDirectories, reorganizedDirectories);
  }, [directoryTree, expandedDirectories, preservedDirectories, reorganizedDirectories]);

  const excludedDirectoryCount = preservedDirectories.size;
  const unassignedItemsCount =
    workspace?.items.filter((item) => !item.preservedStructure && !item.targetGroupLabel).length ?? 0;
  const hasGroupingProposal = Boolean(workspace && (workspace.folders.length > 0 || workspace.strategy));
  const hasSetupChanges = Boolean(
    workspace &&
    (
      selectedStrategy !== workspace.strategy ||
      singleDateHandling !== workspace.dateOptions.singleDateHandling ||
      sourceFolderMode !== workspace.sourceFolderOptions.mode ||
      !areSortedValuesEqual(getSortedSetValues(preservedDirectories), getSortedValues(workspace.preservedDirectories)) ||
      !areSortedValuesEqual(getSortedSetValues(reorganizedDirectories), getSortedValues(workspace.reorganizedDirectories))
    )
  );
  const shouldUpdateGroupingProposal = !hasGroupingProposal || hasSetupChanges;
  const canUseSetupPrimary = Boolean(workspace) &&
    !isReorganizing &&
    canMutateGrouping &&
    (shouldUpdateGroupingProposal ? Boolean(selectedStrategy) : hasGroupingProposal);
  const setupPrimaryLabel = isReorganizing
    ? t('grouping.reorganizing')
    : shouldUpdateGroupingProposal && hasGroupingProposal
      ? t('grouping.updateProposal')
      : shouldUpdateGroupingProposal
        ? t('grouping.reorganize')
        : t('grouping.reviewOrganization');

  const activeFolderTitle = useMemo(() => {
    if (activePreservedFolder) {
      return activePreservedFolder.label;
    }

    if (activeFolderLabel === '__unassigned__') {
      return t('grouping.noProposedFolder');
    }

    return activeFolder?.label ?? t('grouping.allMedia');
  }, [activeFolder, activeFolderLabel, activePreservedFolder, t]);

  const handleBack = () => {
    const from = (location.state as { from?: string } | null)?.from;

    if (from && from !== location.pathname) {
      navigate(from);
      return;
    }

    navigate('/compression');
  };

  const selectStrategy = (strategy: GroupingStrategy) => {
    if (!canMutateGrouping) {
      return;
    }

    if (strategy === 'source-folder') {
      setSourceFolderMode('relative-path');
    }

    setSelectedStrategy(strategy);
  };

  const toggleDirectoryExpansion = (path: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  };

  const setDirectoryStructureMode = (path: string, mode: 'preserve' | 'reorganize') => {
    if (!canMutateGrouping) {
      return;
    }

    setPreservedDirectories((current) => {
      const next = new Set(current);
      if (mode === 'preserve') {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });

    setReorganizedDirectories((current) => {
      const next = new Set(current);
      if (mode === 'reorganize') {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  };

  const handleReorganize = async () => {
    if (!workspace || !selectedStrategy || !canMutateGrouping) {
      return;
    }

    setIsReorganizing(true);

    try {
      const nextWorkspace = await reorganizeGroupingWorkspaceRequest(workspace.sessionId, {
        strategy: selectedStrategy,
        dateOptions: { singleDateHandling },
        sourceFolderOptions: { mode: sourceFolderMode },
        preservedDirectories: Array.from(preservedDirectories).sort((left, right) => left.localeCompare(right)),
        reorganizedDirectories: Array.from(reorganizedDirectories).sort((left, right) => left.localeCompare(right))
      });

      setWorkspace(nextWorkspace);
      setSelectedStrategy(nextWorkspace.strategy ?? 'date');
      setSingleDateHandling(nextWorkspace.dateOptions.singleDateHandling);
      setSourceFolderMode(nextWorkspace.sourceFolderOptions.mode);
      setPreservedDirectories(new Set(nextWorkspace.preservedDirectories));
      setReorganizedDirectories(new Set(nextWorkspace.reorganizedDirectories));
      setSelectedIds(new Set());
      setActiveFolderLabel('__all__');
      changeGroupingView('review');
      setBackendError(null);
      markGroupingDraftChanged();
      void notifyCompletion('groupingReorganized', {
        title: t('notifications.groupingReorganized.title'),
        body: t('notifications.groupingReorganized.body', { count: nextWorkspace.items.length })
      });
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.reorganizeError'));
    } finally {
      setIsReorganizing(false);
    }
  };

  const handleSetupPrimaryAction = async () => {
    if (shouldUpdateGroupingProposal) {
      await handleReorganize();
      return;
    }

    changeGroupingView('review');
  };

  const handleCreateFolder = () => {
    if (!workspace || !canMutateGrouping) return;
    setBackendError(null);
    setFormDialog({ kind: 'create-folder', name: '' });
  };

  const handleRenameFolder = (folder: GroupingWorkspaceFolder) => {
    if (!workspace || !canMutateGrouping) return;
    setBackendError(null);
    setFormDialog({ kind: 'rename-folder', folder, name: folder.label });
  };

  const handleRenamePreservedFolder = (scope: PreservedFolderScope) => {
    if (!workspace || !canMutateGrouping) return;
    setBackendError(null);
    setFormDialog({ kind: 'rename-preserved-folder', scopePath: scope.path, currentLabel: scope.label, name: scope.label });
  };

  const handleDeleteFolder = async (folder: GroupingWorkspaceFolder) => {
    if (!workspace || !canMutateGrouping) return;

    try {
      await deleteGroupingFolderRequest(workspace.sessionId, folder.id);
      setActiveFolderLabel('__all__');
      await refreshWorkspace(workspace.sessionId);
      markGroupingDraftChanged();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.deleteFolderError'));
    }
  };

  const moveItemsToFolder = async (itemIds: string[], targetGroupLabel: string) => {
    if (!workspace || itemIds.length === 0 || !canMutateGrouping) return;

    const uniqueItemIds = Array.from(new Set(itemIds));

    try {
      const nextWorkspace = await assignGroupingItemsRequest(workspace.sessionId, uniqueItemIds, targetGroupLabel);
      setWorkspace(nextWorkspace);
      setSelectedIds(new Set());
      setActiveFolderLabel(resolveNextActiveFolderLabel(nextWorkspace, activeFolderLabel));
      setBackendError(null);
      markGroupingDraftChanged();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.moveMediaError'));
    }
  };

  const handleMoveSelected = async (targetGroupLabel: string) => {
    await moveItemsToFolder(Array.from(selectedIds), targetGroupLabel);
  };

  const showPreviousPreview = useCallback(() => {
    if (!canShowPreviousPreview) {
      return;
    }

    setPreviewItemId(folderScopeItems[previewIndex - 1].id);
  }, [canShowPreviousPreview, folderScopeItems, previewIndex]);

  const showNextPreview = useCallback(() => {
    if (!canShowNextPreview) {
      return;
    }

    setPreviewItemId(folderScopeItems[previewIndex + 1].id);
  }, [canShowNextPreview, folderScopeItems, previewIndex]);

  const handleDeleteSelected = async () => {
    if (!workspace || selectedItems.length === 0 || !canMutateGrouping) return;

    const confirmed = window.confirm(t('grouping.deleteSelectedConfirm'));

    if (!confirmed) {
      return;
    }

    try {
      const nextWorkspace = await deleteGroupingItemsRequest(
        workspace.sessionId,
        selectedItems.map((item) => item.id)
      );
      setWorkspace(nextWorkspace);
      setSelectedIds(new Set());
      setActiveFolderLabel(resolveNextActiveFolderLabel(nextWorkspace, activeFolderLabel));
      setBackendError(null);
      markGroupingDraftChanged();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.deleteSelectedError'));
    }
  };

  const handleDeletePreviewItem = async () => {
    if (!workspace || !previewItem || previewIndex < 0 || !canMutateGrouping) return;

    const confirmed = window.confirm(t('grouping.deletePreviewConfirm', { name: previewItem.fileName }));

    if (!confirmed) {
      return;
    }

    try {
      const nextWorkspace = await deleteGroupingItemsRequest(workspace.sessionId, [previewItem.id]);
      setWorkspace(nextWorkspace);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(previewItem.id);
        return next;
      });
      setPreviewItemId(getNextPreviewItemId(nextWorkspace.items, activeFolderLabel, sourceRootPath, previewIndex));
      setActiveFolderLabel(resolveNextActiveFolderLabel(nextWorkspace, activeFolderLabel));
      setBackendError(null);
      markGroupingDraftChanged();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.deletePreviewError'));
    }
  };

  const handleMovePreviewItem = async (targetGroupLabel: string) => {
    if (!workspace || !previewItem || previewIndex < 0 || !targetGroupLabel || !canMutateGrouping) return;

    try {
      const nextWorkspace = await assignGroupingItemsRequest(workspace.sessionId, [previewItem.id], targetGroupLabel);
      setWorkspace(nextWorkspace);
      setSelectedIds(new Set());
      setPreviewItemId(getNextPreviewItemId(nextWorkspace.items, activeFolderLabel, sourceRootPath, previewIndex, previewItem.id));
      setActiveFolderLabel(resolveNextActiveFolderLabel(nextWorkspace, activeFolderLabel));
      setBackendError(null);
      markGroupingDraftChanged();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.movePreviewError'));
    }
  };

  const cleanupModalVideo = useCallback(() => {
    const video = modalVideoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  useEffect(() => cleanupModalVideo, [cleanupModalVideo, previewItemId]);

  const closePreviewModal = useCallback(() => {
    cleanupModalVideo();
    setPreviewItemId(null);
  }, [cleanupModalVideo]);

  const markPreviewFailed = useCallback((itemId: string) => {
    setFailedPreviewIds((current) => new Set(current).add(itemId));
  }, []);

  const markThumbnailFailed = useCallback((itemId: string) => {
    setFailedThumbnailIds((current) => new Set(current).add(itemId));
  }, []);

  const getMarqueePoint = (event: PointerEvent<HTMLElement>): Point | null => {
    const container = groupingMainRef.current;

    if (!container) {
      return null;
    }

    const rect = container.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const getMarqueeItemIds = (start: Point, end: Point) => {
    const container = groupingMainRef.current;

    if (!container) {
      return [];
    }

    const containerRect = container.getBoundingClientRect();
    const marquee = getNormalizedRect(start, end);
    const marqueeDomRect = new DOMRect(
      containerRect.left + marquee.left,
      containerRect.top + marquee.top,
      marquee.width,
      marquee.height
    );

    return Array.from(container.querySelectorAll<HTMLElement>('[data-grouping-item-id]'))
      .filter((element) => rectsIntersect(element.getBoundingClientRect(), marqueeDomRect))
      .map((element) => element.dataset.groupingItemId)
      .filter((itemId): itemId is string => Boolean(itemId));
  };

  const updateMarqueeSelection = (nextCurrent: Point, selection: MarqueeSelection) => {
    const marqueeIds = getMarqueeItemIds(selection.anchor, nextCurrent);
    const nextSelectedIds = new Set(selection.isAdditive ? Array.from(selection.initialSelectedIds) : []);

    for (const itemId of marqueeIds) {
      nextSelectedIds.add(itemId);
    }

    setSelectedIds(nextSelectedIds);
    setMarqueeSelection({ ...selection, current: nextCurrent });
  };

  const handleMarqueePointerDown = (event: PointerEvent<HTMLElement>) => {
    const target = event.target;

    if (
      !canMutateGrouping ||
      event.button !== 0 ||
      previewItem ||
      !(target instanceof HTMLElement) ||
      target.closest('.grouping-media-card, button, input, select, textarea, a, .grouping-selection-bar, .grouping-main-head')
    ) {
      return;
    }

    const point = getMarqueePoint(event);

    if (!point) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();

    const selection = {
      anchor: point,
      current: point,
      initialSelectedIds: selectedIds,
      isAdditive: event.ctrlKey || event.metaKey
    };

    setMarqueeSelection(selection);

    if (!selection.isAdditive) {
      setSelectedIds(new Set());
    }
  };

  const handleMarqueePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!marqueeSelection) {
      return;
    }

    const point = getMarqueePoint(event);

    if (!point) {
      return;
    }

    event.preventDefault();
    updateMarqueeSelection(point, marqueeSelection);
  };

  const endMarqueeSelection = (event: PointerEvent<HTMLElement>) => {
    if (!marqueeSelection) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setMarqueeSelection(null);
  };

  const handleItemClick = (item: GroupingWorkspaceItem, event: MouseEvent) => {
    if (!canMutateGrouping) {
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(event.shiftKey || event.ctrlKey || event.metaKey ? current : []);

      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }

      return next;
    });
  };

  const handleCreateTemplate = () => {
    if (!canMutateGrouping) return;
    setBackendError(null);
    setFormDialog({ kind: 'create-template', name: '', pattern: '', patternTouched: false });
  };

  const closeFormDialog = useCallback(() => {
    setBackendError(null);
    setFormDialog(null);
  }, []);

  const submitFormDialog = async () => {
    if (!formDialog || !workspace || !canMutateGrouping || isSubmittingFormDialog) return;

    setIsSubmittingFormDialog(true);
    setBackendError(null);
    try {
      if (formDialog.kind === 'create-folder') {
        const label = formDialog.name.trim();
        if (!label) return;
        await createGroupingFolderRequest(workspace.sessionId, label);
        await refreshWorkspace(workspace.sessionId);
        markGroupingDraftChanged();
      } else if (formDialog.kind === 'rename-folder') {
        const label = formDialog.name.trim();
        if (!label || label === formDialog.folder.label) return;
        await renameGroupingFolderRequest(workspace.sessionId, formDialog.folder.id, label);
        setActiveFolderLabel(sanitizeGroupingFolderLabel(label));
        await refreshWorkspace(workspace.sessionId);
        markGroupingDraftChanged();
      } else if (formDialog.kind === 'rename-preserved-folder') {
        const label = formDialog.name.trim();
        if (!label || label === formDialog.currentLabel) return;
        const nextWorkspace = await renamePreservedGroupingFolderScopeRequest(workspace.sessionId, formDialog.scopePath, label);
        setWorkspace(nextWorkspace);
        setSelectedIds(new Set());
        setActiveFolderLabel(resolveNextActiveFolderLabel(nextWorkspace, sanitizeGroupingFolderLabel(label)));
        markGroupingDraftChanged();
      } else {
        const name = formDialog.name.trim();
        const pattern = formDialog.pattern.trim();
        if (!name || !pattern) return;
        const response = await createGroupingTemplateRequest({ name, pattern, enabled: true });
        setWorkspace((current) => (current ? { ...current, templates: response.templates } : current));
      }

      setFormDialog(null);
    } catch (error) {
      const fallback = formDialog.kind === 'create-folder'
        ? t('grouping.createFolderError')
        : formDialog.kind === 'rename-folder' || formDialog.kind === 'rename-preserved-folder'
          ? t('grouping.renameFolderError')
          : t('grouping.createTemplateError');
      setBackendError(error instanceof Error ? error.message : fallback);
    } finally {
      setIsSubmittingFormDialog(false);
    }
  };

  const handleToggleTemplate = async (template: GroupingFolderTemplate) => {
    if (!canMutateGrouping) return;

    try {
      const response = await updateGroupingTemplateRequest(template.id, { enabled: !template.enabled });
      setWorkspace((current) => (current ? { ...current, templates: response.templates } : current));
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.updateTemplateError'));
    }
  };

  const handleDeleteTemplate = async (template: GroupingFolderTemplate) => {
    if (!canMutateGrouping) return;

    try {
      await deleteGroupingTemplateRequest(template.id);
      setWorkspace((current) =>
        current ? { ...current, templates: current.templates.filter((candidate) => candidate.id !== template.id) } : current
      );
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.deleteTemplateError'));
    }
  };

  const handleCreateFolderFromTemplate = async (template: GroupingFolderTemplate) => {
    if (!workspace || !canMutateGrouping) return;

    try {
      await createGroupingFolderFromTemplateRequest(workspace.sessionId, template.id);
      await refreshWorkspace(workspace.sessionId);
      markGroupingDraftChanged();
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.createFromTemplateError'));
    }
  };

  useEffect(() => {
    if (!previewItem) {
      return;
    }

    const handlePreviewKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormControl =
        target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

      if (event.key === 'Escape') {
        event.preventDefault();
        closePreviewModal();
        return;
      }

      if (isFormControl) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showPreviousPreview();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        showNextPreview();
      }
    };

    window.addEventListener('keydown', handlePreviewKeyDown);

    return () => {
      window.removeEventListener('keydown', handlePreviewKeyDown);
    };
  }, [closePreviewModal, previewItem, showNextPreview, showPreviousPreview]);

  const handleApply = async () => {
    if (!workspace || !canMutateGrouping) return;

    setIsApplying(true);

    try {
      const result = await applyGroupingWorkspaceRequest(workspace.sessionId);
      setVerification(result.verification);

      if (result.status === 'completed') {
        completeGroupingSession();
        void notifyCompletion('organizationApplied', {
          title: t('notifications.organizationApplied.title'),
          body: t('notifications.organizationApplied.body', { count: result.movedItems })
        });
      } else {
        failGroupingSession(t('grouping.failedApply', { count: result.failedItems }));
      }

      setBackendError(null);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('grouping.applyError');
      setBackendError(message);
      failGroupingSession(message);
    } finally {
      setIsApplying(false);
    }
  };

  const handleReset = async () => {
    if (!workspace || !canMutateGrouping) return;

    const confirmed = window.confirm(t('grouping.resetConfirm'));

    if (!confirmed) {
      return;
    }

    setIsResetting(true);

    try {
      const result = await resetGroupingWorkspaceRequest(workspace.sessionId);
      setVerification(result.verification);
      const nextWorkspace = await refreshWorkspace(workspace.sessionId);
      setSelectedStrategy(nextWorkspace.strategy);
      setSingleDateHandling(nextWorkspace.dateOptions.singleDateHandling);
      setSourceFolderMode(nextWorkspace.sourceFolderOptions.mode);
      setPreservedDirectories(new Set(nextWorkspace.preservedDirectories));
      setReorganizedDirectories(new Set(nextWorkspace.reorganizedDirectories));
      setSelectedIds(new Set());
      setPreviewItemId(null);
      setActiveFolderLabel('__all__');
      changeGroupingView('setup');
      startGroupingSession({
        backendSessionId: workspace.sessionId,
        activeView: 'setup',
        outputRootLabel: workspace.outputDir
      });
      markGroupingDraftChanged();

      if (result.status === 'partial_failed') {
        failGroupingSession(t('grouping.resetPartialFailure', { count: result.failedItems }));
        setBackendError(t('grouping.resetPartialFailure', { count: result.failedItems }));
      } else {
        setBackendError(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('grouping.resetError');
      setBackendError(message);
      failGroupingSession(message);
    } finally {
      setIsResetting(false);
    }
  };

  const mediaUrl = previewItem && workspace
    ? previewItem.mediaType === 'image'
      ? buildGroupingPreviewUrl(workspace.sessionId, previewItem.id)
      : buildGroupingMediaUrl(workspace.sessionId, previewItem.id)
    : null;
  const isFormDialogSubmitDisabled = !formDialog || formDialog.kind === 'create-template'
    ? !formDialog || !formDialog.name.trim() || !formDialog.pattern.trim()
    : !formDialog.name.trim() || (
      (formDialog.kind === 'rename-folder' && formDialog.name.trim() === formDialog.folder.label) ||
      (formDialog.kind === 'rename-preserved-folder' && formDialog.name.trim() === formDialog.currentLabel)
    );

  const hasCopiedHeic = Boolean(workspace?.items.some((item) => /\.(heic|heif)$/i.test(item.fileName)));

  return (
    <div className={`grouping-workspace page-stack ${!canMutateGrouping ? 'is-read-only' : ''}`}>
      <div className="page-header grouping-header">
        <div>
          <h1 className="page-title">{t('grouping.title')}</h1>
          <p className="page-subtitle">
            {workspace
              ? t('grouping.subtitle', { count: workspace.items.length, path: workspace.outputDir })
              : t('grouping.preparing')}
          </p>
        </div>
        <div className="grouping-header-actions">
          <button className="btn btn-secondary" type="button" onClick={handleBack}>
            {t('grouping.back')}
          </button>
          {view === 'setup' && (
            <button className="btn btn-primary" type="button" onClick={() => void handleSetupPrimaryAction()} disabled={!canUseSetupPrimary}>
              {setupPrimaryLabel}
            </button>
          )}
          {view === 'review' && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => changeGroupingView('setup')}
              disabled={!workspace || isApplying || isResetting || !canMutateGrouping}
            >
              {t('grouping.editSetup')}
            </button>
          )}
          {view === 'review' && (
            <button
              className="btn btn-danger-secondary"
              type="button"
              onClick={() => void handleReset()}
              disabled={!workspace || isApplying || isResetting || !canMutateGrouping}
            >
              {isResetting ? t('grouping.resetting') : t('grouping.reset')}
            </button>
          )}
          {view === 'review' && (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void handleApply()}
              disabled={!workspace || isApplying || isResetting || !canMutateGrouping}
            >
              {isApplying ? t('grouping.applying') : t('grouping.apply')}
            </button>
          )}
          {isGroupingCompleted && (
            <button className="btn btn-secondary" type="button" onClick={() => navigate('/export')}>
              {t('grouping.continueExport')}
            </button>
          )}
        </div>
      </div>

      {!canMutateGrouping && (
        <p className="page-summary-note compression-warning">{t('grouping.exportActiveReadOnlyNotice')}</p>
      )}
      {hasCopiedHeic && (
        <p className="page-summary-note compression-warning">{t('grouping.heicPreviewLimited')}</p>
      )}

      {isWaitingForWorkspacePrerequisites && !workspace && !backendError && (
        <p className="empty-note">{t('grouping.loadingWorkspace')}</p>
      )}
      {!isWaitingForWorkspacePrerequisites && !workspace && !canOpenWorkspace && !backendError && (
        <p className="empty-note">{t('grouping.unavailable')}</p>
      )}
      {backendError && <p className="error">{backendError}</p>}

      {verification && (
        <section className={`verification-panel verification-panel-${verification.status}`}>
          <div className="verification-head">
            <div>
              <p className="page-section-title">{t('verification.title')}</p>
              <p className="page-summary-note">
                {verification.status === 'ok'
                  ? t('verification.okDescription')
                  : verification.status === 'mismatch'
                    ? t('verification.mismatchDescription')
                    : t('verification.notVerifiedDescription')}
              </p>
            </div>
            <span className={`verification-status verification-status-${verification.status}`}>
              {t(VERIFICATION_STATUS_KEYS[verification.status])}
            </span>
          </div>
          <div className="verification-grid">
            <div>
              <strong>{t('verification.expected')}</strong>
              <span>{t('verification.counts', {
                total: verification.expected.total,
                images: verification.expected.images,
                videos: verification.expected.videos,
                unknown: verification.expected.unknown
              })}</span>
            </div>
            <div>
              <strong>{t('verification.destination')}</strong>
              <span>{t('verification.counts', {
                total: verification.destination.total,
                images: verification.destination.images,
                videos: verification.destination.videos,
                unknown: verification.destination.unknown
              })}</span>
            </div>
            <div>
              <strong>{t('verification.verifiedAt')}</strong>
              <span>{formatDateTime(verification.verifiedAt)}</span>
            </div>
          </div>
          {verification.status === 'mismatch' && (
            <div className="verification-actions">
              <button className="btn btn-secondary" type="button" onClick={() => changeGroupingView('review')}>
                {t('verification.reviewAgain')}
              </button>
            </div>
          )}
        </section>
      )}

      {workspace && view === 'setup' && (
        <div className="grouping-setup-layout">
          <section className="page-card elevated grouping-setup-main">
            <div className="grouping-section-head">
              <div>
                <p className="page-section-title">{t('grouping.setupRules')}</p>
                <p className="page-summary-note">{t('grouping.setupRulesNote')}</p>
              </div>
            </div>

            <div className="grouping-strategy-selector" role="group" aria-label={t('grouping.strategySelectorLabel')}>
              <button
                className={`grouping-strategy-segment ${selectedStrategy === 'date' ? 'is-active' : ''}`}
                type="button"
                aria-pressed={selectedStrategy === 'date'}
                onClick={() => selectStrategy('date')}
                disabled={!canMutateGrouping}
              >
                <strong>{t('grouping.strategy.date')}</strong>
                <span className="grouping-strategy-badge">{t('grouping.strategy.recommended')}</span>
              </button>
              <button
                className={`grouping-strategy-segment ${selectedStrategy === 'source-folder' ? 'is-active' : ''}`}
                type="button"
                aria-pressed={selectedStrategy === 'source-folder'}
                onClick={() => selectStrategy('source-folder')}
                disabled={!canMutateGrouping}
              >
                <strong>{t('grouping.strategy.sourceFolder')}</strong>
              </button>
            </div>

            {selectedStrategy === 'date' && (
              <div className="grouping-strategy-panel">
                <div className="grouping-strategy-config">
                  <div className="grouping-config-label">
                    <span>{t('grouping.dateMultipleFiles')}</span>
                    <InfoTooltip label={t('grouping.moreInformation')}>
                      <strong>{t('grouping.dateHelpTitle')}</strong>
                      <span>{t('grouping.dateEventNote')}</span>
                      <span>{t('grouping.noDateHandlingNote')}</span>
                    </InfoTooltip>
                  </div>
                  <div className="grouping-fixed-rule">
                    <span>{t('grouping.dateMultipleFilesResult')}</span>
                    <code>YYYY.MM.dd - Event</code>
                  </div>
                  <label className="grouping-option-field">
                    <span>{t('grouping.singleDateHandling')}</span>
                    <select
                      value={singleDateHandling}
                      onChange={(event) => setSingleDateHandling(event.target.value as GroupingSingleDateHandling)}
                      disabled={!canMutateGrouping}
                    >
                      <option value="daily-event">{t('grouping.singleDate.dailyEvent')}</option>
                      <option value="year-unique">{t('grouping.singleDate.yearUnique')}</option>
                      <option value="keep-original">{t('grouping.singleDate.keepOriginal')}</option>
                    </select>
                  </label>
                </div>
                <div className="grouping-result-preview" aria-live="polite">
                  <strong>{t('grouping.resultPreview')}</strong>
                  <div className="grouping-example" aria-label={t('grouping.exampleLabel')}>
                    <div className="grouping-example-side grouping-example-before">
                      <span>{t('grouping.exampleBefore')}</span>
                      <ul>
                        {DATE_EXAMPLE_FILES.map((fileName) => <li key={fileName}><code>Camera/{fileName}</code></li>)}
                      </ul>
                    </div>
                    <span className="grouping-example-arrow" aria-hidden="true">→</span>
                    <div className="grouping-example-side grouping-example-after">
                      <span>{t('grouping.exampleAfter')}</span>
                      <div className="grouping-example-group">
                        <code>2012.09.15 - Event/</code>
                        <ul>
                          {DATE_EXAMPLE_FILES.slice(0, 2).map((fileName) => <li key={fileName}><code>{fileName}</code></li>)}
                        </ul>
                      </div>
                      <div className="grouping-example-group">
                        <code>{SINGLE_DATE_EXAMPLE_DESTINATIONS[singleDateHandling]}/</code>
                        <ul><li><code>{DATE_EXAMPLE_FILES[2]}</code></li></ul>
                        {singleDateHandling === 'keep-original' && <small>{t('grouping.notMoved')}</small>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedStrategy === 'source-folder' && (
              <div className="grouping-strategy-panel grouping-source-folder-panel">
                <div className="grouping-strategy-config">
                  <div className="grouping-config-label">
                    <strong>{t('grouping.strategy.sourceFolderDescription')}</strong>
                    <InfoTooltip label={t('grouping.moreInformation')}>
                      <strong>{t('grouping.sourceFolderHelpTitle')}</strong>
                      <span>{t('grouping.sourceFolderUsefulFor')}</span>
                      <span>{t('grouping.sourceFolderDateAlternative')}</span>
                      <span>{t('grouping.sourceFolderRootFiles')}</span>
                    </InfoTooltip>
                  </div>
                  <p className="grouping-inline-warning">{t('grouping.sourceFolderFlattens')}</p>
                </div>
                <div className="grouping-result-preview">
                  <strong>{t('grouping.resultPreview')}</strong>
                  <div className="grouping-example" aria-label={t('grouping.exampleLabel')}>
                    <div className="grouping-example-side grouping-example-before">
                      <span>{t('grouping.exampleBefore')}</span>
                      <code>Mobile/WhatsApp/2024/{SOURCE_FOLDER_EXAMPLE_FILE}</code>
                    </div>
                    <span className="grouping-example-arrow" aria-hidden="true">→</span>
                    <div className="grouping-example-side grouping-example-after">
                      <span>{t('grouping.exampleAfter')}</span>
                      <code>Mobile - WhatsApp - 2024/{SOURCE_FOLDER_EXAMPLE_FILE}</code>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <details className="page-card elevated grouping-exclusions grouping-setup-main" open>
            <summary>
              <span className="grouping-exclusions-leading">
                <span className="grouping-exclusions-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M3 7.5h7l2-2h9v13H3z" />
                    <path d="m9 13 2 2 4-4" />
                  </svg>
                </span>
                <span className="grouping-exclusions-title">
                  <strong>{t('grouping.setupFolders')}</strong>
                  <span>{t('grouping.exclusionsDescription')}</span>
                </span>
              </span>
              <span className="grouping-exclusions-actions">
                <span>{t('grouping.excludedCount', { count: excludedDirectoryCount })}</span>
                <span className="grouping-exclusions-cta">{t('grouping.reviewFolders')}</span>
                <svg className="grouping-exclusions-chevron" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m6 8 4 4 4-4" />
                </svg>
              </span>
            </summary>
            <div className="grouping-exclusions-content">
              <p className="page-summary-note">{t('grouping.setupFoldersNote')}</p>
              <ul className="grouping-directory-list">
              {directoryRows.map((row) => (
                <li
                  className={`grouping-directory-row ${row.isPreserved ? 'is-preserved' : ''}`}
                  key={row.path}
                  style={{ paddingLeft: `${12 + row.depth * 18}px` }}
                >
                  <div className="grouping-directory-main">
                    {row.hasChildren ? (
                      <button className="selection-tree-toggle" type="button" onClick={() => toggleDirectoryExpansion(row.path)}>
                        {row.isExpanded ? '-' : '+'}
                      </button>
                    ) : (
                      <span className="selection-tree-toggle-spacer" aria-hidden="true" />
                    )}
                    <div className="selection-tree-copy">
                      <div className="selection-row-head">
                        <strong>{row.name}</strong>
                        <span className="page-chip">{row.isPreserved ? t('grouping.keepStructure') : t('grouping.reorganizeMode')}</span>
                        {row.isPreservedOverride && <span className="page-chip">{t('grouping.keepOverride')}</span>}
                        {row.isPreserved && !row.isPreservedOverride && <span className="page-chip">{t('grouping.inherited')}</span>}
                        {row.isReorganizedOverride && <span className="page-chip">{t('grouping.reorganizeOverride')}</span>}
                      </div>
                      <p className="selection-row-note">{row.path}</p>
                    </div>
                  </div>
                  <div className="selection-tree-meta">
                    <div className="selection-structure-toggle" aria-label={t('grouping.structureMode')}>
                      <button
                        className={row.isPreserved ? 'is-active' : ''}
                        type="button"
                        onClick={() => setDirectoryStructureMode(row.path, 'preserve')}
                        disabled={!canMutateGrouping}
                      >
                        {t('grouping.keepStructure')}
                      </button>
                      <button
                        className={!row.isPreserved ? 'is-active' : ''}
                        type="button"
                        onClick={() => setDirectoryStructureMode(row.path, 'reorganize')}
                        disabled={!canMutateGrouping}
                      >
                        {t('grouping.reorganizeMode')}
                      </button>
                    </div>
                    <span>{t('selection.fileCount', { count: row.fileCount })}</span>
                    <span>{formatBytes(row.sizeBytes)}</span>
                  </div>
                </li>
              ))}
              </ul>
            </div>
          </details>
        </div>
      )}

      {workspace && view === 'review' && <div className="grouping-toolbar">
        <input
          className="grouping-search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={t('grouping.searchPlaceholder')}
          type="search"
        />
        <button className="btn btn-secondary" type="button" onClick={() => void handleCreateFolder()} disabled={!workspace || !canMutateGrouping}>
          {t('grouping.newFolder')}
        </button>
      </div>}

      {workspace && view === 'review' && <div className="grouping-layout">
        <aside className="grouping-sidebar">
          <button
            className={`grouping-folder-button ${activeFolderLabel === '__all__' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setActiveFolderLabel('__all__')}
          >
            <span>{t('grouping.allMedia')}</span>
            <strong>{workspace?.items.length ?? 0}</strong>
          </button>

          <div className="grouping-folder-list">
            {preservedFolderScopes.map((scope) => (
              <div
                key={scope.path}
                className={`grouping-folder-drop ${activeFolderLabel === scope.activeLabel ? 'is-active' : ''}`}
              >
                <button className="grouping-folder-button" type="button" onClick={() => setActiveFolderLabel(scope.activeLabel)}>
                  <span>{scope.label}</span>
                  <strong>{scope.itemCount}</strong>
                </button>
                <div className="grouping-folder-actions">
                  <button type="button" onClick={() => handleRenamePreservedFolder(scope)} disabled={!canMutateGrouping} title={t('grouping.renameTitle')}>
                    {t('grouping.rename')}
                  </button>
                  <button type="button" disabled={!canMutateGrouping || scope.itemCount > 0} title={t('grouping.deleteTitle')}>
                    {t('grouping.delete')}
                  </button>
                </div>
              </div>
            ))}
            {unassignedItemsCount > 0 && (
              <div className={`grouping-folder-drop grouping-folder-drop-unassigned ${activeFolderLabel === '__unassigned__' ? 'is-active' : ''}`}>
                <button className="grouping-folder-button" type="button" onClick={() => setActiveFolderLabel('__unassigned__')}>
                  <span>{t('grouping.noProposedFolder')}</span>
                  <strong>{unassignedItemsCount}</strong>
                </button>
                <p className="grouping-folder-note">{t('grouping.noProposedFolderNote')}</p>
              </div>
            )}
            {workspace?.folders.map((folder) => (
              <div
                key={folder.id}
                className={`grouping-folder-drop ${activeFolderLabel === folder.label ? 'is-active' : ''}`}
                onDragOver={canMutateGrouping ? (event) => event.preventDefault() : undefined}
                onDrop={canMutateGrouping
                  ? (event) => {
                      event.preventDefault();
                      const ids = event.dataTransfer.getData('application/json');
                      if (ids) {
                        void moveItemsToFolder(JSON.parse(ids) as string[], folder.label);
                      }
                    }
                  : undefined}
              >
                <button className="grouping-folder-button" type="button" onClick={() => setActiveFolderLabel(folder.label)}>
                  <span>{folder.label}</span>
                  <strong>{folder.itemCount}</strong>
                </button>
                <div className="grouping-folder-actions">
                  <button type="button" onClick={() => void handleRenameFolder(folder)} disabled={!canMutateGrouping} title={t('grouping.renameTitle')}>
                    {t('grouping.rename')}
                  </button>
                  <button type="button" onClick={() => void handleDeleteFolder(folder)} disabled={!canMutateGrouping || folder.itemCount > 0} title={t('grouping.deleteTitle')}>
                    {t('grouping.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grouping-templates">
            <div className="grouping-section-head">
              <p className="page-section-title">{t('grouping.templates')}</p>
              <button type="button" onClick={() => void handleCreateTemplate()} disabled={!canMutateGrouping}>
                {t('grouping.add')}
              </button>
            </div>
            {workspace?.templates.length ? (
              workspace.templates.map((template) => (
                <div key={template.id} className="grouping-template-row">
                  <button type="button" onClick={() => void handleCreateFolderFromTemplate(template)} disabled={!canMutateGrouping || !template.enabled}>
                    {template.name}
                  </button>
                  <button type="button" onClick={() => void handleToggleTemplate(template)} disabled={!canMutateGrouping}>
                    {template.enabled ? t('grouping.on') : t('grouping.off')}
                  </button>
                  <button type="button" onClick={() => void handleDeleteTemplate(template)} disabled={!canMutateGrouping}>
                    {t('grouping.delete')}
                  </button>
                </div>
              ))
            ) : (
              <p className="page-summary-note">{t('grouping.noTemplates')}</p>
            )}
          </div>
        </aside>

        <section
          className={`grouping-main ${marqueeSelection ? 'is-selecting-area' : ''}`}
          ref={groupingMainRef}
          onPointerDown={handleMarqueePointerDown}
          onPointerMove={handleMarqueePointerMove}
          onPointerUp={endMarqueeSelection}
          onPointerCancel={endMarqueeSelection}
        >
          {selectedItems.length > 0 && (
            <div className="grouping-selection-bar">
              <strong>{t('grouping.selected', { count: selectedItems.length })}</strong>
              <select
                className="grouping-select"
                value=""
                onChange={(event) => {
                  if (event.target.value) {
                    void handleMoveSelected(event.target.value);
                  }
                }}
                disabled={!workspace || !canMutateGrouping}
              >
                <option value="">{t('grouping.moveSelected')}</option>
                {workspace?.folders.map((folder) => (
                  <option key={folder.id} value={folder.label}>
                    {folder.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-danger-secondary" type="button" onClick={() => void handleDeleteSelected()} disabled={!canMutateGrouping}>
                {t('grouping.delete')}
              </button>
              <span className="grouping-selection-divider" aria-hidden="true" />
              <button className="btn btn-secondary" type="button" onClick={() => setSelectedIds(new Set())}>
                {t('grouping.clearSelection')}
              </button>
            </div>
          )}

          <div className="grouping-main-head">
            <div>
              <p className="page-section-title">{activeFolderTitle}</p>
              <p className="page-summary-note">{t('grouping.visibleFiles', { count: visibleItems.length })}</p>
            </div>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setSelectedIds(new Set(visibleItems.map((item) => item.id)))}
              disabled={!canMutateGrouping || visibleItems.length === 0}
            >
              {t('grouping.selectVisible')}
            </button>
          </div>

          {isLoading ? (
            <p className="empty-note">{t('grouping.loadingWorkspace')}</p>
          ) : (
            <div className="grouping-media-grid">
              {marqueeRect && (
                <div
                  className="grouping-marquee"
                  style={{
                    left: `${marqueeRect.left}px`,
                    top: `${marqueeRect.top}px`,
                    width: `${marqueeRect.width}px`,
                    height: `${marqueeRect.height}px`
                  }}
                />
              )}
              {renderedItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const canEditItem = canMutateGrouping;
                const itemThumbnailUrl = workspace ? buildGroupingThumbnailUrl(workspace.sessionId, item.id) : '';
                const itemVideoPosterUrl = workspace ? buildGroupingVideoPosterUrl(workspace.sessionId, item.id) : '';
                const itemVideoPosterCacheKey = workspace ? `${workspace.sessionId}:${item.id}` : item.id;
                const hasThumbnailFailed = failedThumbnailIds.has(item.id);

                return (
                  <article
                    key={item.id}
                    data-grouping-item-id={item.id}
                    className={`grouping-media-card ${isSelected ? 'is-selected' : ''} ${item.preservedStructure ? 'is-preserved' : ''}`}
                    draggable={canEditItem}
                    onClick={canEditItem ? (event) => handleItemClick(item, event) : undefined}
                    onDragStart={canEditItem
                      ? (event) => {
                          event.dataTransfer.setData('application/json', JSON.stringify(getSelectedDragPayload(item, selectedIds)));
                          event.dataTransfer.effectAllowed = 'move';
                        }
                      : undefined}
                  >
                    <GroupingMediaPreview
                      item={item}
                      imageThumbnailUrl={itemThumbnailUrl}
                      videoPosterSourceUrl={itemVideoPosterUrl}
                      videoPosterCacheKey={itemVideoPosterCacheKey}
                      hasPreviewFailed={hasThumbnailFailed}
                      previewUnavailableLabel={t('grouping.previewUnavailable')}
                      onPreviewFailed={markThumbnailFailed}
                      onOpenPreview={() => setPreviewItemId(item.id)}
                    />
                    <div className="grouping-media-meta">
                      <strong title={item.fileName}>{item.fileName}</strong>
                      <span>{item.captureDate ?? t('grouping.noDate')} - {formatBytes(item.sizeBytes)}</span>
                      {item.preservedStructure && <span>{t('grouping.preservedStructure')}</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!isLoading && canRenderMoreItems && (
            <div className="grouping-load-more">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setRenderedItemLimit((current) => current + GROUPING_GRID_INCREMENT)}
              >
                {t('grouping.showMoreMedia', {
                  shown: renderedItems.length,
                  total: visibleItems.length
                })}
              </button>
            </div>
          )}
        </section>
      </div>}

      {workspace && previewItem && mediaUrl && (
        <div className="grouping-modal" role="dialog" aria-modal="true">
          <div className="grouping-modal-panel">
            <div className="grouping-modal-head">
              <div className="grouping-modal-title">
                <strong>{previewItem.fileName}</strong>
                <span>{t('grouping.previewCounter', { current: previewIndex + 1, total: folderScopeItems.length })}</span>
              </div>
              <button className="btn btn-secondary" type="button" onClick={closePreviewModal}>
                {t('grouping.close')}
              </button>
            </div>
            <div className="grouping-modal-actions">
              <button className="btn btn-secondary" type="button" onClick={showPreviousPreview} disabled={!canShowPreviousPreview}>
                {t('grouping.previewPrevious')}
              </button>
              <button className="btn btn-secondary" type="button" onClick={showNextPreview} disabled={!canShowNextPreview}>
                {t('grouping.previewNext')}
              </button>
              <select
                className="grouping-select"
                value=""
                onChange={(event) => {
                  if (event.target.value) {
                    void handleMovePreviewItem(event.target.value);
                  }
                }}
                disabled={!canMutateGrouping || workspace.folders.length === 0}
                aria-label={t('grouping.movePreview')}
              >
                <option value="">{t('grouping.movePreview')}</option>
                {workspace.folders.map((folder) => (
                  <option key={folder.id} value={folder.label}>
                    {folder.label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-danger-secondary"
                type="button"
                onClick={() => void handleDeletePreviewItem()}
                disabled={!canMutateGrouping}
              >
                {t('grouping.delete')}
              </button>
            </div>
            <div className="grouping-modal-stage">
              {previewItem.mediaType === 'image' && !failedPreviewIds.has(previewItem.id) ? (
                <img
                  className="grouping-modal-media"
                  src={mediaUrl}
                  alt={previewItem.fileName}
                  onError={() => markPreviewFailed(previewItem.id)}
                />
              ) : previewItem.mediaType === 'image' ? (
                <div className="grouping-modal-unsupported">
                  {t('grouping.previewUnavailable')}
                </div>
              ) : previewItem.mediaType === 'video' && mediaUrl && !failedPreviewIds.has(previewItem.id) ? (
                <video
                  key={previewItem.id}
                  ref={modalVideoRef}
                  className="grouping-modal-media"
                  src={mediaUrl}
                  controls
                  autoPlay
                  onError={(event) => {
                    console.warn('Could not decode grouping video preview.', { mediaErrorCode: event.currentTarget.error?.code ?? null });
                    markPreviewFailed(previewItem.id);
                  }}
                />
              ) : previewItem.mediaType === 'video' ? (
                <div className="grouping-modal-unsupported">
                  {t('grouping.videoPreviewUnavailable')}
                </div>
              ) : (
                <div className="grouping-modal-unsupported">
                  {previewItem.fileName.split('.').pop()?.toUpperCase() ?? 'FILE'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {formDialog && (
        <GroupingFormDialog
          title={formDialog.kind === 'create-folder'
            ? t('grouping.createFolderTitle')
            : formDialog.kind === 'rename-folder' || formDialog.kind === 'rename-preserved-folder'
              ? t('grouping.renameTitle')
              : t('grouping.createTemplateTitle')}
          submitLabel={formDialog.kind === 'rename-folder' || formDialog.kind === 'rename-preserved-folder'
            ? t('grouping.rename')
            : t('grouping.create')}
          cancelLabel={t('grouping.cancel')}
          isSubmitting={isSubmittingFormDialog}
          submitDisabled={isFormDialogSubmitDisabled}
          error={backendError}
          onSubmit={() => void submitFormDialog()}
          onCancel={closeFormDialog}
        >
          {formDialog.kind === 'create-template' ? (
            <>
              <label>
                <span>{t('grouping.templateNamePrompt')}</span>
                <input
                  autoFocus
                  value={formDialog.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setFormDialog((current) => current?.kind === 'create-template'
                      ? { ...current, name, pattern: current.patternTouched ? current.pattern : name }
                      : current);
                  }}
                  disabled={isSubmittingFormDialog}
                />
              </label>
              <label>
                <span>{t('grouping.templatePatternPrompt')}</span>
                <input
                  value={formDialog.pattern}
                  onChange={(event) => setFormDialog((current) => current?.kind === 'create-template'
                    ? { ...current, pattern: event.target.value, patternTouched: true }
                    : current)}
                  disabled={isSubmittingFormDialog}
                />
              </label>
            </>
          ) : (
            <label>
              <span>{formDialog.kind === 'create-folder' ? t('grouping.folderNamePrompt') : t('grouping.newFolderNamePrompt')}</span>
              <input
                autoFocus
                value={formDialog.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setFormDialog((current) => current && current.kind !== 'create-template' ? { ...current, name } : current);
                }}
                disabled={isSubmittingFormDialog}
              />
            </label>
          )}
        </GroupingFormDialog>
      )}
    </div>
  );
};

export default GroupingPage;
