import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import { completeGroupingSession, failGroupingSession, startGroupingSession } from '../services/grouping-job.store';
import {
  applyGroupingWorkspaceRequest,
  assignGroupingItemsRequest,
  buildGroupingMediaUrl,
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
  type GroupingWorkspaceItem
} from '../services/grouping.service';

const formatBytes = (value: number) => {
  if (value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;

  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const getSelectedDragPayload = (item: GroupingWorkspaceItem, selectedIds: Set<string>) => {
  if (selectedIds.has(item.id)) {
    return Array.from(selectedIds);
  }

  return [item.id];
};

type GroupingView = 'setup' | 'review';

const DEFAULT_SINGLE_DATE_HANDLING: GroupingSingleDateHandling = 'year-unique';
const DEFAULT_SOURCE_FOLDER_MODE: GroupingSourceFolderMode = 'nearest-folder';

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
  const [previewItem, setPreviewItem] = useState<GroupingWorkspaceItem | null>(null);

  const sourcePath = sourceSelection?.path ?? '';
  const destinationPath = destinationSelection?.path ?? '';
  const hasWorkspacePrerequisites = Boolean(sourcePath && destinationPath && compressionSessionState.backendSessionId);
  const canOpenWorkspace = hasWorkspacePrerequisites && compressionSessionState.status === 'completed';
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

  const activeFolder = useMemo(() => {
    if (!workspace || activeFolderLabel === '__all__') {
      return null;
    }

    return workspace.folders.find((folder) => folder.label === activeFolderLabel) ?? null;
  }, [activeFolderLabel, workspace]);

  const visibleItems = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();

    return workspace.items.filter((item) => {
      const matchesFolder =
        activeFolderLabel === '__all__' ||
        (activeFolderLabel === '__preserved__' && item.preservedStructure) ||
        (activeFolderLabel === '__unassigned__' && !item.preservedStructure && !item.targetGroupLabel) ||
        item.targetGroupLabel === activeFolderLabel;
      const matchesSearch =
        !normalizedSearch ||
        item.fileName.toLowerCase().includes(normalizedSearch) ||
        item.relativePath.toLowerCase().includes(normalizedSearch);

      return matchesFolder && matchesSearch;
    });
  }, [activeFolderLabel, searchTerm, workspace]);

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
  const canReorganize = Boolean(selectedStrategy && workspace) && !isReorganizing;

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
    const from = (location.state as { from?: string } | null)?.from;

    if (from && from !== location.pathname) {
      navigate(from);
      return;
    }

    navigate('/compression');
  };

  const selectStrategy = (strategy: GroupingStrategy) => {
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
    if (!workspace || !selectedStrategy) {
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
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.reorganizeError'));
    } finally {
      setIsReorganizing(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!workspace) return;

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
    if (!workspace) return;

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
    if (!workspace) return;

    try {
      await deleteGroupingFolderRequest(workspace.sessionId, folder.id);
      setActiveFolderLabel('__all__');
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.deleteFolderError'));
    }
  };

  const moveItemsToFolder = async (itemIds: string[], targetGroupLabel: string) => {
    if (!workspace || itemIds.length === 0) return;

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

  const handleDeleteSelected = async () => {
    if (!workspace || selectedIds.size === 0) return;

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

  const handleItemClick = (item: GroupingWorkspaceItem, event: MouseEvent) => {
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
    try {
      const response = await updateGroupingTemplateRequest(template.id, { enabled: !template.enabled });
      setWorkspace((current) => (current ? { ...current, templates: response.templates } : current));
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.updateTemplateError'));
    }
  };

  const handleDeleteTemplate = async (template: GroupingFolderTemplate) => {
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
    if (!workspace) return;

    try {
      await createGroupingFolderFromTemplateRequest(workspace.sessionId, template.id);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : t('grouping.createFromTemplateError'));
    }
  };

  const handleApply = async () => {
    if (!workspace) return;

    setIsApplying(true);

    try {
      const result = await applyGroupingWorkspaceRequest(workspace.sessionId);

      if (result.status === 'completed') {
        completeGroupingSession();
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

  const mediaUrl = previewItem && workspace ? buildGroupingMediaUrl(workspace.sessionId, previewItem.id) : null;

  return (
    <div className="grouping-workspace page-stack">
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
          <button className="btn btn-secondary" type="button" onClick={handleBack}>
            {t('grouping.back')}
          </button>
          {view === 'setup' && (
            <button className="btn btn-primary" type="button" onClick={() => void handleReorganize()} disabled={!canReorganize}>
              {isReorganizing ? t('grouping.reorganizing') : t('grouping.reorganize')}
            </button>
          )}
          {view === 'review' && (
            <button className="btn btn-secondary" type="button" onClick={() => setView('setup')} disabled={!workspace || isApplying}>
              {t('grouping.editSetup')}
            </button>
          )}
          {view === 'review' && (
            <button className="btn btn-primary" type="button" onClick={() => void handleApply()} disabled={!workspace || isApplying}>
              {isApplying ? t('grouping.applying') : t('grouping.apply')}
            </button>
          )}
          {groupingSessionState.status === 'completed' && (
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
              >
                {t('grouping.strategy.date')}
              </button>
              <button
                className={`grouping-rule-chip ${selectedStrategy === 'source-folder' ? 'is-active' : ''}`}
                type="button"
                aria-pressed={selectedStrategy === 'source-folder'}
                onClick={() => selectStrategy('source-folder')}
              >
                {t('grouping.strategy.sourceFolder')}
              </button>
            </div>

            {selectedStrategy === 'date' && (
              <div className="grouping-strategy-options">
                <p className="page-summary-note">{t('grouping.dateStrategyPattern')}</p>
                <label className="grouping-option-field">
                  <span>{t('grouping.singleDateHandling')}</span>
                  <select value={singleDateHandling} onChange={(event) => setSingleDateHandling(event.target.value as GroupingSingleDateHandling)}>
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
                  <select value={sourceFolderMode} onChange={(event) => setSourceFolderMode(event.target.value as GroupingSourceFolderMode)}>
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
                      <button className={row.isPreserved ? 'is-active' : ''} type="button" onClick={() => setDirectoryStructureMode(row.path, 'preserve')}>
                        {t('grouping.keepStructure')}
                      </button>
                      <button className={!row.isPreserved ? 'is-active' : ''} type="button" onClick={() => setDirectoryStructureMode(row.path, 'reorganize')}>
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
        <button className="btn btn-secondary" type="button" onClick={() => void handleCreateFolder()} disabled={!workspace}>
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
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const ids = event.dataTransfer.getData('application/json');
                  if (ids) {
                    void moveItemsToFolder(JSON.parse(ids) as string[], folder.label);
                  }
                }}
              >
                <button className="grouping-folder-button" type="button" onClick={() => setActiveFolderLabel(folder.label)}>
                  <span>{folder.label}</span>
                  <strong>{folder.itemCount}</strong>
                </button>
                <div className="grouping-folder-actions">
                  <button type="button" onClick={() => void handleRenameFolder(folder)} title={t('grouping.renameTitle')}>
                    {t('grouping.rename')}
                  </button>
                  <button type="button" onClick={() => void handleDeleteFolder(folder)} disabled={folder.itemCount > 0} title={t('grouping.deleteTitle')}>
                    {t('grouping.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grouping-templates">
            <div className="grouping-section-head">
              <p className="page-section-title">{t('grouping.templates')}</p>
              <button type="button" onClick={() => void handleCreateTemplate()}>
                {t('grouping.add')}
              </button>
            </div>
            {workspace?.templates.length ? (
              workspace.templates.map((template) => (
                <div key={template.id} className="grouping-template-row">
                  <button type="button" onClick={() => void handleCreateFolderFromTemplate(template)} disabled={!template.enabled}>
                    {template.name}
                  </button>
                  <button type="button" onClick={() => void handleToggleTemplate(template)}>
                    {template.enabled ? t('grouping.on') : t('grouping.off')}
                  </button>
                  <button type="button" onClick={() => void handleDeleteTemplate(template)}>
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
                disabled={!workspace}
              >
                <option value="">{t('grouping.moveSelected')}</option>
                {workspace?.folders.map((folder) => (
                  <option key={folder.id} value={folder.label}>
                    {folder.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-danger-secondary" type="button" onClick={() => void handleDeleteSelected()}>
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
            <button className="btn btn-ghost" type="button" onClick={() => setSelectedIds(new Set(visibleItems.map((item) => item.id)))}>
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

                return (
                  <article
                    key={item.id}
                    className={`grouping-media-card ${isSelected ? 'is-selected' : ''}`}
                    draggable
                    onClick={(event) => handleItemClick(item, event)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/json', JSON.stringify(getSelectedDragPayload(item, selectedIds)));
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    <button className="grouping-media-preview" type="button" onDoubleClick={() => setPreviewItem(item)}>
                      {item.mediaType === 'image' ? (
                        <img src={itemMediaUrl} alt={item.fileName} loading="lazy" />
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

      {previewItem && mediaUrl && (
        <div className="grouping-modal" role="dialog" aria-modal="true">
          <div className="grouping-modal-panel">
            <div className="grouping-modal-head">
              <strong>{previewItem.fileName}</strong>
              <button className="btn btn-secondary" type="button" onClick={() => setPreviewItem(null)}>
                {t('grouping.close')}
              </button>
            </div>
            {previewItem.mediaType === 'image' ? (
              <img className="grouping-modal-media" src={mediaUrl} alt={previewItem.fileName} />
            ) : (
              <video className="grouping-modal-media" src={mediaUrl} controls autoPlay />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GroupingPage;
