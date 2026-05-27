import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation, type TranslationKey } from '../i18n';
import { notifyCompletion } from '../services/completion-notification.service';
import { completeGroupingSession, failGroupingSession, startGroupingSession } from '../services/grouping-job.store';
import {
  applyGroupingWorkspaceRequest,
  assignGroupingItemsRequest,
  buildGroupingMediaUrl,
  buildGroupingPreviewUrl,
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

const formatBytes = (value: number) => {
  if (value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;

  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
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

const getItemsForFolderScope = (items: GroupingWorkspaceItem[], activeFolderLabel: string) =>
  items.filter((item) => {
    if (activeFolderLabel === '__all__') {
      return true;
    }

    if (activeFolderLabel === '__preserved__') {
      return item.preservedStructure;
    }

    if (activeFolderLabel === '__unassigned__') {
      return !item.preservedStructure && !item.targetGroupLabel;
    }

    return item.targetGroupLabel === activeFolderLabel;
  });

const getNextPreviewItemId = (
  items: GroupingWorkspaceItem[],
  activeFolderLabel: string,
  previousIndex: number,
  preferredItemId?: string
) => {
  const scopedItems = getItemsForFolderScope(items, activeFolderLabel);

  if (preferredItemId && scopedItems.some((item) => item.id === preferredItemId)) {
    return preferredItemId;
  }

  if (scopedItems.length === 0) {
    return null;
  }

  return scopedItems[Math.min(Math.max(previousIndex, 0), scopedItems.length - 1)].id;
};

type GroupingView = 'setup' | 'review';

const DEFAULT_SINGLE_DATE_HANDLING: GroupingSingleDateHandling = 'year-unique';
const DEFAULT_SOURCE_FOLDER_MODE: GroupingSourceFolderMode = 'nearest-folder';
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

const formatPath = (path: string) => path.split('\\').join('/');

const getPathName = (path: string) => formatPath(path).split('/').filter(Boolean).pop() ?? path;

const getDirectoryPath = (relativePath: string) => {
  const normalized = formatPath(relativePath);
  const segments = normalized.split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
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

export const GroupingPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [isReorganizing, setIsReorganizing] = useState(false);
  const [view, setView] = useState<GroupingView>('setup');
  const [selectedStrategy, setSelectedStrategy] = useState<GroupingStrategy | null>(null);
  const [singleDateHandling, setSingleDateHandling] = useState<GroupingSingleDateHandling>(DEFAULT_SINGLE_DATE_HANDLING);
  const [sourceFolderMode, setSourceFolderMode] = useState<GroupingSourceFolderMode>(DEFAULT_SOURCE_FOLDER_MODE);
  const [preservedDirectories, setPreservedDirectories] = useState<Set<string>>(new Set());
  const [reorganizedDirectories, setReorganizedDirectories] = useState<Set<string>>(new Set());
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(new Set());
  const [verification, setVerification] = useState<ExecutionVerification | null>(null);

  const sourcePath = sourceSelection?.path ?? '';
  const destinationPath = destinationSelection?.path ?? '';
  const hasWorkspacePrerequisites = Boolean(sourcePath && destinationPath && compressionSessionState.backendSessionId);
  const canOpenWorkspace = hasWorkspacePrerequisites && compressionSessionState.status === 'completed';
  const isGroupingCompleted = groupingSessionState.status === 'completed';
  const canMutateGrouping = !isGroupingCompleted;
  const isWaitingForWorkspacePrerequisites =
    isLoadingFolderSelections || (hasWorkspacePrerequisites && compressionSessionState.status === 'running');

  const refreshWorkspace = useCallback(
    async (sessionId: string) => {
      const nextWorkspace = await getGroupingWorkspaceRequest(sessionId);
      setWorkspace(nextWorkspace);
      setBackendError(null);
      return nextWorkspace;
    },
    []
  );

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
        setSelectedStrategy(nextWorkspace.strategy);
        setSingleDateHandling(nextWorkspace.dateOptions.singleDateHandling);
        setSourceFolderMode(nextWorkspace.sourceFolderOptions.mode);
        setPreservedDirectories(new Set(nextWorkspace.preservedDirectories));
        setReorganizedDirectories(new Set(nextWorkspace.reorganizedDirectories));
        setExpandedDirectories(new Set([nextWorkspace.sourceDir.split(/[\\/]/).filter(Boolean).pop() ?? 'Source']));
        setView(nextWorkspace.folders.length > 0 || nextWorkspace.strategy ? 'review' : 'setup');
        setBackendError(null);

        if (!groupingSessionState.backendSessionId) {
          startGroupingSession({
            backendSessionId: nextWorkspace.sessionId,
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
    groupingSessionState.backendSessionId,
    sourcePath
  ]);

  useEffect(() => {
    if (!isGroupingCompleted) {
      return;
    }

    setSelectedIds(new Set());
    setView('review');
  }, [isGroupingCompleted]);

  const activeFolder = useMemo(() => {
    if (!workspace || activeFolderLabel === '__all__') {
      return null;
    }

    return workspace.folders.find((folder) => folder.label === activeFolderLabel) ?? null;
  }, [activeFolderLabel, workspace]);

  const folderScopeItems = useMemo(() => {
    if (!workspace) {
      return [];
    }

    return getItemsForFolderScope(workspace.items, activeFolderLabel);
  }, [activeFolderLabel, workspace]);

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

  const previewItem = useMemo(() => {
    if (!workspace || !previewItemId) {
      return null;
    }

    return workspace.items.find((item) => item.id === previewItemId) ?? null;
  }, [previewItemId, workspace]);

  const previewIndex = previewItem ? folderScopeItems.findIndex((item) => item.id === previewItem.id) : -1;
  const canShowPreviousPreview = previewIndex > 0;
  const canShowNextPreview = previewIndex >= 0 && previewIndex < folderScopeItems.length - 1;

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

  const preservedCount = directoryRows.filter((row) => row.isPreserved).length;
  const preservedItemsCount = workspace?.items.filter((item) => item.preservedStructure).length ?? 0;
  const unassignedItemsCount =
    workspace?.items.filter((item) => !item.preservedStructure && !item.targetGroupLabel).length ?? 0;
  const preservedGroupLabel = useMemo(() => {
    if (preservedDirectories.size === 1) {
      return getPathName(Array.from(preservedDirectories)[0]);
    }

    return t('grouping.originalStructure');
  }, [preservedDirectories, t]);
  const canReorganize = Boolean(selectedStrategy && workspace) && !isReorganizing && canMutateGrouping;

  const activeFolderTitle = useMemo(() => {
    if (activeFolderLabel === '__preserved__') {
      return preservedGroupLabel;
    }

    if (activeFolderLabel === '__unassigned__') {
      return t('grouping.noProposedFolder');
    }

    return activeFolder?.label ?? t('grouping.allMedia');
  }, [activeFolder, activeFolderLabel, preservedGroupLabel, t]);

  const handleBack = () => {
    if (isGroupingCompleted) {
      return;
    }

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

    setSelectedStrategy((current) => (current === strategy ? null : strategy));
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
      setSelectedStrategy(nextWorkspace.strategy);
      setSingleDateHandling(nextWorkspace.dateOptions.singleDateHandling);
      setSourceFolderMode(nextWorkspace.sourceFolderOptions.mode);
      setPreservedDirectories(new Set(nextWorkspace.preservedDirectories));
      setReorganizedDirectories(new Set(nextWorkspace.reorganizedDirectories));
      setSelectedIds(new Set());
      setActiveFolderLabel('__all__');
      setView('review');
      setBackendError(null);
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

  const handleCreateFolder = async () => {
    if (!workspace || !canMutateGrouping) return;

    const label = window.prompt(t('grouping.folderNamePrompt'));
    if (!label?.trim()) return;

    try {
      await createGroupingFolderRequest(workspace.sessionId, label);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.createFolderError'));
    }
  };

  const handleRenameFolder = async (folder: GroupingWorkspaceFolder) => {
    if (!workspace || !canMutateGrouping) return;

    const label = window.prompt(t('grouping.newFolderNamePrompt'), folder.label);
    if (!label?.trim() || label === folder.label) return;

    try {
      await renameGroupingFolderRequest(workspace.sessionId, folder.id, label);
      setActiveFolderLabel(label);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.renameFolderError'));
    }
  };

  const handleDeleteFolder = async (folder: GroupingWorkspaceFolder) => {
    if (!workspace || !canMutateGrouping) return;

    try {
      await deleteGroupingFolderRequest(workspace.sessionId, folder.id);
      setActiveFolderLabel('__all__');
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.deleteFolderError'));
    }
  };

  const moveItemsToFolder = async (itemIds: string[], targetGroupLabel: string) => {
    if (!workspace || itemIds.length === 0 || !canMutateGrouping) return;

    try {
      const nextWorkspace = await assignGroupingItemsRequest(workspace.sessionId, itemIds, targetGroupLabel);
      setWorkspace(nextWorkspace);
      setSelectedIds(new Set());
      setBackendError(null);
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
    if (!workspace || selectedIds.size === 0 || !canMutateGrouping) return;

    const confirmed = window.confirm(t('grouping.deleteSelectedConfirm'));

    if (!confirmed) {
      return;
    }

    try {
      const nextWorkspace = await deleteGroupingItemsRequest(workspace.sessionId, Array.from(selectedIds));
      setWorkspace(nextWorkspace);
      setSelectedIds(new Set());
      setBackendError(null);
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
      setPreviewItemId(getNextPreviewItemId(nextWorkspace.items, activeFolderLabel, previewIndex));
      setBackendError(null);
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
      setPreviewItemId(getNextPreviewItemId(nextWorkspace.items, activeFolderLabel, previewIndex, previewItem.id));
      setBackendError(null);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.movePreviewError'));
    }
  };

  const markPreviewFailed = (itemId: string) => {
    setFailedPreviewIds((current) => new Set(current).add(itemId));
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

  const handleCreateTemplate = async () => {
    if (!canMutateGrouping) return;

    const name = window.prompt(t('grouping.templateNamePrompt'));
    if (!name?.trim()) return;

    const pattern = window.prompt(t('grouping.templatePatternPrompt'), name);
    if (!pattern?.trim()) return;

    try {
      const response = await createGroupingTemplateRequest({ name, pattern, enabled: true });
      setWorkspace((current) => (current ? { ...current, templates: response.templates } : current));
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.createTemplateError'));
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
        setPreviewItemId(null);
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
  }, [previewItem, showNextPreview, showPreviousPreview]);

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

  const mediaUrl = previewItem && workspace
    ? previewItem.mediaType === 'image'
      ? buildGroupingPreviewUrl(workspace.sessionId, previewItem.id)
      : buildGroupingMediaUrl(workspace.sessionId, previewItem.id)
    : null;

  return (
    <div className={`grouping-workspace page-stack ${isGroupingCompleted ? 'is-read-only' : ''}`}>
      <div className="page-header grouping-header">
        <div>
          <h2 className="page-title">{t('grouping.title')}</h2>
          <p className="page-subtitle">
            {workspace
              ? t('grouping.subtitle', { count: workspace.items.length, path: workspace.outputDir })
              : t('grouping.preparing')}
          </p>
        </div>
        <div className="grouping-header-actions">
          <button className="btn btn-secondary" type="button" onClick={handleBack} disabled={isGroupingCompleted}>
            {t('grouping.back')}
          </button>
          {view === 'setup' && (
            <button className="btn btn-primary" type="button" onClick={() => void handleReorganize()} disabled={!canReorganize}>
              {isReorganizing ? t('grouping.reorganizing') : t('grouping.reorganize')}
            </button>
          )}
          {view === 'review' && (
            <button className="btn btn-secondary" type="button" onClick={() => setView('setup')} disabled={!workspace || isApplying || isGroupingCompleted}>
              {t('grouping.editSetup')}
            </button>
          )}
          {view === 'review' && (
            <button className="btn btn-primary" type="button" onClick={() => void handleApply()} disabled={!workspace || isApplying || isGroupingCompleted}>
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
              <button className="btn btn-secondary" type="button" onClick={() => setView('review')}>
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

            <div className="grouping-rule-list">
              <button
                className={`grouping-rule-chip ${selectedStrategy === 'date' ? 'is-active' : ''}`}
                type="button"
                aria-pressed={selectedStrategy === 'date'}
                onClick={() => selectStrategy('date')}
                disabled={!canMutateGrouping}
              >
                {t('grouping.strategy.date')}
              </button>
              <button
                className={`grouping-rule-chip ${selectedStrategy === 'source-folder' ? 'is-active' : ''}`}
                type="button"
                aria-pressed={selectedStrategy === 'source-folder'}
                onClick={() => selectStrategy('source-folder')}
                disabled={!canMutateGrouping}
              >
                {t('grouping.strategy.sourceFolder')}
              </button>
            </div>

            {selectedStrategy === 'date' && (
              <div className="grouping-strategy-options">
                <p className="page-summary-note">{t('grouping.dateStrategyPattern')}</p>
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
            )}

            {selectedStrategy === 'source-folder' && (
              <div className="grouping-strategy-options">
                <p className="page-summary-note">{t('grouping.sourceFolderStrategyNote')}</p>
                <label className="grouping-option-field">
                  <span>{t('grouping.sourceFolderMode')}</span>
                  <select
                    value={sourceFolderMode}
                    onChange={(event) => setSourceFolderMode(event.target.value as GroupingSourceFolderMode)}
                    disabled={!canMutateGrouping}
                  >
                    <option value="nearest-folder">{t('grouping.sourceFolder.nearest')}</option>
                    <option value="relative-path">{t('grouping.sourceFolder.relative')}</option>
                  </select>
                </label>
              </div>
            )}

            <p className="page-summary-note">{selectedStrategy ? t('grouping.strategySelected') : t('grouping.noStrategySelected')}</p>
          </section>

          <section className="page-card elevated grouping-setup-main">
            <p className="page-section-title">{t('grouping.setupFolders')}</p>
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
          </section>

          <aside className="page-card elevated grouping-setup-side">
            <p className="page-section-title">{t('grouping.setupSummary')}</p>
            <p className="page-summary-note">{t('grouping.setupSummaryText', {
              files: workspace.items.length,
              preserved: preservedCount,
              strategy: selectedStrategy ? 1 : 0
            })}</p>
          </aside>
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
        <button className="btn btn-secondary" type="button" onClick={() => void handleCreateFolder()} disabled={!workspace || isGroupingCompleted}>
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
            {preservedItemsCount > 0 && (
              <div className={`grouping-folder-drop grouping-folder-drop-preserved ${activeFolderLabel === '__preserved__' ? 'is-active' : ''}`}>
                <button className="grouping-folder-button" type="button" onClick={() => setActiveFolderLabel('__preserved__')}>
                  <span>{preservedGroupLabel}</span>
                  <strong>{preservedItemsCount}</strong>
                </button>
              </div>
            )}
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
                  <button type="button" onClick={() => void handleRenameFolder(folder)} disabled={isGroupingCompleted} title={t('grouping.renameTitle')}>
                    {t('grouping.rename')}
                  </button>
                  <button type="button" onClick={() => void handleDeleteFolder(folder)} disabled={isGroupingCompleted || folder.itemCount > 0} title={t('grouping.deleteTitle')}>
                    {t('grouping.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grouping-templates">
            <div className="grouping-section-head">
              <p className="page-section-title">{t('grouping.templates')}</p>
              <button type="button" onClick={() => void handleCreateTemplate()} disabled={isGroupingCompleted}>
                {t('grouping.add')}
              </button>
            </div>
            {workspace?.templates.length ? (
              workspace.templates.map((template) => (
                <div key={template.id} className="grouping-template-row">
                  <button type="button" onClick={() => void handleCreateFolderFromTemplate(template)} disabled={isGroupingCompleted || !template.enabled}>
                    {template.name}
                  </button>
                  <button type="button" onClick={() => void handleToggleTemplate(template)} disabled={isGroupingCompleted}>
                    {template.enabled ? t('grouping.on') : t('grouping.off')}
                  </button>
                  <button type="button" onClick={() => void handleDeleteTemplate(template)} disabled={isGroupingCompleted}>
                    {t('grouping.delete')}
                  </button>
                </div>
              ))
            ) : (
              <p className="page-summary-note">{t('grouping.noTemplates')}</p>
            )}
          </div>
        </aside>

        <section className="grouping-main">
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
                disabled={!workspace || isGroupingCompleted}
              >
                <option value="">{t('grouping.moveSelected')}</option>
                {workspace?.folders.map((folder) => (
                  <option key={folder.id} value={folder.label}>
                    {folder.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-danger-secondary" type="button" onClick={() => void handleDeleteSelected()} disabled={isGroupingCompleted}>
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
            <button className="btn btn-ghost" type="button" onClick={() => setSelectedIds(new Set(visibleItems.map((item) => item.id)))} disabled={isGroupingCompleted}>
              {t('grouping.selectVisible')}
            </button>
          </div>

          {isLoading ? (
            <p className="empty-note">{t('grouping.loadingWorkspace')}</p>
          ) : (
            <div className="grouping-media-grid">
              {visibleItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const itemMediaUrl = workspace ? buildGroupingMediaUrl(workspace.sessionId, item.id) : '';
                const itemPreviewUrl = workspace ? buildGroupingPreviewUrl(workspace.sessionId, item.id) : '';
                const hasPreviewFailed = failedPreviewIds.has(item.id);

                return (
                  <article
                    key={item.id}
                    className={`grouping-media-card ${isSelected ? 'is-selected' : ''}`}
                    draggable={canMutateGrouping}
                    onClick={canMutateGrouping ? (event) => handleItemClick(item, event) : undefined}
                    onDragStart={canMutateGrouping
                      ? (event) => {
                          event.dataTransfer.setData('application/json', JSON.stringify(getSelectedDragPayload(item, selectedIds)));
                          event.dataTransfer.effectAllowed = 'move';
                        }
                      : undefined}
                  >
                    <button className="grouping-media-preview" type="button" onDoubleClick={() => setPreviewItemId(item.id)}>
                      {item.mediaType === 'image' && !hasPreviewFailed ? (
                        <img src={itemPreviewUrl} alt={item.fileName} loading="lazy" onError={() => markPreviewFailed(item.id)} />
                      ) : item.mediaType === 'image' ? (
                        <span>{t('grouping.previewUnavailable')}</span>
                      ) : item.mediaType === 'video' ? (
                        <video src={itemMediaUrl} muted preload="metadata" />
                      ) : (
                        <span>{item.fileName.split('.').pop()?.toUpperCase() ?? 'FILE'}</span>
                      )}
                    </button>
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
              <button className="btn btn-secondary" type="button" onClick={() => setPreviewItemId(null)}>
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
              <button className="btn btn-danger-secondary" type="button" onClick={() => void handleDeletePreviewItem()} disabled={!canMutateGrouping}>
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
              ) : previewItem.mediaType === 'video' ? (
                <video className="grouping-modal-media" src={mediaUrl} controls autoPlay />
              ) : (
                <div className="grouping-modal-unsupported">
                  {previewItem.fileName.split('.').pop()?.toUpperCase() ?? 'FILE'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupingPage;
