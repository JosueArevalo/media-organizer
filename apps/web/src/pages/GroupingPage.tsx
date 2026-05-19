import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
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
  deleteGroupingTemplateRequest,
  getGroupingWorkspaceRequest,
  renameGroupingFolderRequest,
  updateGroupingTemplateRequest,
  type GroupingFolderTemplate,
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

const getFolderLabel = (folder: GroupingWorkspaceFolder | null) => folder?.label ?? 'All media';

const getSelectedDragPayload = (item: GroupingWorkspaceItem, selectedIds: Set<string>) => {
  if (selectedIds.has(item.id)) {
    return Array.from(selectedIds);
  }

  return [item.id];
};

export const GroupingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const compressionSessionState = useCompressionSessionState();
  const groupingSessionState = useGroupingSessionState();
  const [workspace, setWorkspace] = useState<GroupingWorkspace | null>(null);
  const [activeFolderLabel, setActiveFolderLabel] = useState<string>('__all__');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [previewItem, setPreviewItem] = useState<GroupingWorkspaceItem | null>(null);

  const sourcePath = sourceSelection?.path ?? '';
  const destinationPath = destinationSelection?.path ?? '';
  const canOpenWorkspace = Boolean(sourcePath && destinationPath && compressionSessionState.backendSessionId);

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

        const message = error instanceof Error ? error.message : 'Could not open the grouping workspace.';
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
      const matchesFolder = activeFolderLabel === '__all__' || item.targetGroupLabel === activeFolderLabel;
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

  const handleBack = () => {
    const from = (location.state as { from?: string } | null)?.from;

    if (from && from !== location.pathname) {
      navigate(from);
      return;
    }

    navigate('/compression');
  };

  const handleCreateFolder = async () => {
    if (!workspace) return;

    const label = window.prompt('Folder name');
    if (!label?.trim()) return;

    try {
      await createGroupingFolderRequest(workspace.sessionId, label);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not create folder.');
    }
  };

  const handleRenameFolder = async (folder: GroupingWorkspaceFolder) => {
    if (!workspace) return;

    const label = window.prompt('New folder name', folder.label);
    if (!label?.trim() || label === folder.label) return;

    try {
      await renameGroupingFolderRequest(workspace.sessionId, folder.id, label);
      setActiveFolderLabel(label);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not rename folder.');
    }
  };

  const handleDeleteFolder = async (folder: GroupingWorkspaceFolder) => {
    if (!workspace) return;

    try {
      await deleteGroupingFolderRequest(workspace.sessionId, folder.id);
      setActiveFolderLabel('__all__');
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not delete folder.');
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
      setBackendError(error instanceof Error ? error.message : 'Could not move media.');
    }
  };

  const handleMoveSelected = async (targetGroupLabel: string) => {
    await moveItemsToFolder(Array.from(selectedIds), targetGroupLabel);
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
    const name = window.prompt('Template name');
    if (!name?.trim()) return;

    const pattern = window.prompt('Folder pattern. Supported tokens: {year}, {date}', name);
    if (!pattern?.trim()) return;

    try {
      const response = await createGroupingTemplateRequest({ name, pattern, enabled: true });
      setWorkspace((current) => (current ? { ...current, templates: response.templates } : current));
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not create template.');
    }
  };

  const handleToggleTemplate = async (template: GroupingFolderTemplate) => {
    try {
      const response = await updateGroupingTemplateRequest(template.id, { enabled: !template.enabled });
      setWorkspace((current) => (current ? { ...current, templates: response.templates } : current));
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not update template.');
    }
  };

  const handleDeleteTemplate = async (template: GroupingFolderTemplate) => {
    try {
      await deleteGroupingTemplateRequest(template.id);
      setWorkspace((current) =>
        current ? { ...current, templates: current.templates.filter((candidate) => candidate.id !== template.id) } : current
      );
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not delete template.');
    }
  };

  const handleCreateFolderFromTemplate = async (template: GroupingFolderTemplate) => {
    if (!workspace) return;

    try {
      await createGroupingFolderFromTemplateRequest(workspace.sessionId, template.id);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      setBackendError(error instanceof Error ? error.message : 'Could not create folder from template.');
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
        failGroupingSession(`${result.failedItems} files could not be organized.`);
      }

      setBackendError(null);
      await refreshWorkspace(workspace.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not apply organization.';
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
          <h2 className="page-title">Organize destination</h2>
          <p className="page-subtitle">
            {workspace ? `${workspace.items.length} files in ${workspace.outputDir}` : 'Preparing the final media workspace.'}
          </p>
        </div>
        <div className="grouping-header-actions">
          <button className="btn btn-secondary" type="button" onClick={handleBack}>
            Back
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void handleApply()} disabled={!workspace || isApplying}>
            {isApplying ? 'Applying...' : 'Apply organization'}
          </button>
        </div>
      </div>

      {!canOpenWorkspace && (
        <p className="error">Grouping is available after compression completes and source/destination folders are selected.</p>
      )}
      {backendError && <p className="error">{backendError}</p>}

      <div className="grouping-toolbar">
        <input
          className="grouping-search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search media"
          type="search"
        />
        <button className="btn btn-secondary" type="button" onClick={() => void handleCreateFolder()} disabled={!workspace}>
          New folder
        </button>
        <select
          className="grouping-select"
          value=""
          onChange={(event) => {
            if (event.target.value) {
              void handleMoveSelected(event.target.value);
            }
          }}
          disabled={!workspace || selectedIds.size === 0}
        >
          <option value="">Move selected</option>
          {workspace?.folders.map((folder) => (
            <option key={folder.id} value={folder.label}>
              {folder.label}
            </option>
          ))}
        </select>
        <span className="grouping-selection-count">{selectedItems.length} selected</span>
      </div>

      <div className="grouping-layout">
        <aside className="grouping-sidebar">
          <button
            className={`grouping-folder-button ${activeFolderLabel === '__all__' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setActiveFolderLabel('__all__')}
          >
            <span>{getFolderLabel(null)}</span>
            <strong>{workspace?.items.length ?? 0}</strong>
          </button>

          <div className="grouping-folder-list">
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
                  <button type="button" onClick={() => void handleRenameFolder(folder)} title="Rename folder">
                    Rename
                  </button>
                  <button type="button" onClick={() => void handleDeleteFolder(folder)} disabled={folder.itemCount > 0} title="Delete folder">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grouping-templates">
            <div className="grouping-section-head">
              <p className="page-section-title">Templates</p>
              <button type="button" onClick={() => void handleCreateTemplate()}>
                Add
              </button>
            </div>
            {workspace?.templates.length ? (
              workspace.templates.map((template) => (
                <div key={template.id} className="grouping-template-row">
                  <button type="button" onClick={() => void handleCreateFolderFromTemplate(template)} disabled={!template.enabled}>
                    {template.name}
                  </button>
                  <button type="button" onClick={() => void handleToggleTemplate(template)}>
                    {template.enabled ? 'On' : 'Off'}
                  </button>
                  <button type="button" onClick={() => void handleDeleteTemplate(template)}>
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <p className="page-summary-note">No templates yet.</p>
            )}
          </div>
        </aside>

        <section className="grouping-main">
          <div className="grouping-main-head">
            <div>
              <p className="page-section-title">{getFolderLabel(activeFolder)}</p>
              <p className="page-summary-note">{visibleItems.length} visible files</p>
            </div>
            <button className="btn btn-ghost" type="button" onClick={() => setSelectedIds(new Set(visibleItems.map((item) => item.id)))}>
              Select visible
            </button>
          </div>

          {isLoading ? (
            <p className="empty-note">Loading workspace...</p>
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
                      <span>{item.captureDate ?? 'No date'} - {formatBytes(item.sizeBytes)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {previewItem && mediaUrl && (
        <div className="grouping-modal" role="dialog" aria-modal="true">
          <div className="grouping-modal-panel">
            <div className="grouping-modal-head">
              <strong>{previewItem.fileName}</strong>
              <button className="btn btn-secondary" type="button" onClick={() => setPreviewItem(null)}>
                Close
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
