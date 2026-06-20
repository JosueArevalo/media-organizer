import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useCompressionSessionState } from '../hooks/useCompressionJobState';
import { useTranslation } from '../i18n';
import {
  loadFolderSelectionHandle,
  loadSourceSelectionScope,
  saveSourceSelectionScope,
  loadSourceTreeSnapshot,
  type SourceTreeDirectoryNode,
  type SourceTreeNode
} from '../services/folder-selection.store';
import { notifyCompletion } from '../services/completion-notification.service';
import { scanSourceTreeRequest } from '../services/source-tree.service';
import { isPreCompressionStepReadOnly } from '../services/workflow-locks';

type ScannedFile = {
  kind: 'file';
  name: string;
  path: string;
  depth: number;
  sizeBytes: number;
  fileType: string;
};

type ScannedDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  depth: number;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  children: SourceEntry[];
};

type SourceEntry = ScannedDirectory | ScannedFile;

type TreeSummary = {
  includedDirectories: number;
  excludedDirectories: number;
  includedFiles: number;
  excludedFiles: number;
  includedBytes: number;
  excludedBytes: number;
};

type TreeRow = {
  entry: SourceEntry;
  level: number;
  parentExcluded: boolean;
  isExcluded: boolean;
  isExpanded?: boolean;
  hasChildren?: boolean;
};

type ScanState =
  | { status: 'idle'; root: null; error: null }
  | { status: 'loading'; root: null; error: null }
  | { status: 'ready'; root: ScannedDirectory; error: null }
  | { status: 'error'; root: null; error: string };

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

const formatPath = (path: string) => path.split('\\').join('/');

const getFileType = (fileName: string, mimeType = '') => {
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

  if (['pdf', 'doc', 'docx', 'txt'].includes(extension)) {
    return 'document';
  }

  return 'file';
};

const normalizeSnapshotEntry = (entry: SourceTreeNode): SourceEntry => {
  if (entry.kind === 'file') {
    return {
      kind: 'file',
      name: entry.name,
      path: entry.path,
      depth: entry.path.split('/').length - 1,
      sizeBytes: entry.sizeBytes,
      fileType: entry.fileType
    };
  }

  return {
    kind: 'directory',
    name: entry.name,
    path: entry.path,
    depth: entry.path.split('/').length - 1,
    sizeBytes: entry.sizeBytes,
    fileCount: entry.fileCount,
    directoryCount: entry.directoryCount,
    children: entry.children.map(normalizeSnapshotEntry)
  };
};

const normalizeSnapshotRoot = (root: SourceTreeDirectoryNode): ScannedDirectory => {
  const normalized = normalizeSnapshotEntry(root);

  if (normalized.kind !== 'directory') {
    throw new Error('Invalid source tree snapshot');
  }

  return normalized;
};

type CollectedEntry = {
  name: string;
  kind: 'directory' | 'file';
  handle: FileSystemHandle;
};

const collectEntries = async (handle: FileSystemDirectoryHandle) => {
  const entries: CollectedEntry[] = [];

  for await (const entry of handle.entries()) {
    entries.push({
      name: entry[0],
      kind: entry[1].kind,
      handle: entry[1]
    });
  }

  entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  return entries;
};

const scanDirectoryTree = async (handle: FileSystemDirectoryHandle, currentPath = '', depth = 0): Promise<ScannedDirectory> => {
  const entries = await collectEntries(handle);
  const children: SourceEntry[] = [];
  let sizeBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;

  for (const entry of entries) {
    const entryName = entry.name;
    const nextPath = currentPath ? `${currentPath}/${entryName}` : entryName;

    if (entry.kind === 'directory') {
      const directoryHandle = entry.handle as FileSystemDirectoryHandle;
      const childDirectory = await scanDirectoryTree(directoryHandle, nextPath, depth + 1);
      children.push(childDirectory);
      sizeBytes += childDirectory.sizeBytes;
      fileCount += childDirectory.fileCount;
      directoryCount += 1 + childDirectory.directoryCount;
      continue;
    }

    const fileHandle = entry.handle as FileSystemFileHandle;
    const file = await fileHandle.getFile();

    children.push({
      kind: 'file',
      name: entryName,
      path: nextPath,
      depth: depth + 1,
      sizeBytes: file.size,
      fileType: getFileType(entryName, file.type)
    });

    sizeBytes += file.size;
    fileCount += 1;
  }

  return {
    kind: 'directory',
    name: handle.name,
    path: currentPath || handle.name,
    depth,
    sizeBytes,
    fileCount,
    directoryCount,
    children
  };
};

const isUnderExcludedDirectory = (path: string, excludedDirectories: Set<string>) => {
  const segments = formatPath(path).split('/');
  let currentPath = '';

  for (let index = 0; index < segments.length - 1; index += 1) {
    currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];

    if (excludedDirectories.has(currentPath)) {
      return true;
    }
  }

  return false;
};

const isDirectoryExcluded = (
  path: string,
  excludedDirectories: Set<string>,
  includedDirectories: Set<string>,
  ancestorExcluded: boolean
) => excludedDirectories.has(path) || (ancestorExcluded && !includedDirectories.has(path));

const isFileExcluded = (path: string, excludedFiles: Set<string>, includedFiles: Set<string>, ancestorExcluded: boolean) =>
  excludedFiles.has(path) || (ancestorExcluded && !includedFiles.has(path));

const summarizeTree = (
  entry: SourceEntry,
  excludedDirectories: Set<string>,
  excludedFiles: Set<string>,
  includedDirectories: Set<string>,
  includedFiles: Set<string>,
  ancestorExcluded = false
): TreeSummary => {
  if (entry.kind === 'file') {
    const isExcluded = isFileExcluded(entry.path, excludedFiles, includedFiles, ancestorExcluded);

    return {
      includedDirectories: 0,
      excludedDirectories: 0,
      includedFiles: isExcluded ? 0 : 1,
      excludedFiles: isExcluded ? 1 : 0,
      includedBytes: isExcluded ? 0 : entry.sizeBytes,
      excludedBytes: isExcluded ? entry.sizeBytes : 0
    };
  }

  const directoryExcluded = isDirectoryExcluded(entry.path, excludedDirectories, includedDirectories, ancestorExcluded);
  const summary: TreeSummary = {
    includedDirectories: directoryExcluded ? 0 : 1,
    excludedDirectories: directoryExcluded ? 1 : 0,
    includedFiles: 0,
    excludedFiles: 0,
    includedBytes: 0,
    excludedBytes: 0
  };

  for (const child of entry.children) {
    const childSummary = summarizeTree(
      child,
      excludedDirectories,
      excludedFiles,
      includedDirectories,
      includedFiles,
      directoryExcluded
    );
    summary.includedDirectories += childSummary.includedDirectories;
    summary.excludedDirectories += childSummary.excludedDirectories;
    summary.includedFiles += childSummary.includedFiles;
    summary.excludedFiles += childSummary.excludedFiles;
    summary.includedBytes += childSummary.includedBytes;
    summary.excludedBytes += childSummary.excludedBytes;
  }

  return summary;
};

const flattenTree = (
  entry: SourceEntry,
  excludedDirectories: Set<string>,
  excludedFiles: Set<string>,
  includedDirectories: Set<string>,
  includedFiles: Set<string>,
  expandedDirectories: Set<string>,
  rows: TreeRow[] = [],
  ancestorExcluded = false
) => {
  if (entry.kind === 'directory') {
    const directoryExcluded = isDirectoryExcluded(entry.path, excludedDirectories, includedDirectories, ancestorExcluded);
    const hasChildren = entry.children.length > 0;
    const isExpanded = expandedDirectories.has(entry.path);
    rows.push({
      entry,
      level: entry.depth,
      parentExcluded: ancestorExcluded,
      isExcluded: directoryExcluded,
      isExpanded,
      hasChildren
    });

    if (isExpanded) {
      for (const child of entry.children) {
        flattenTree(
          child,
          excludedDirectories,
          excludedFiles,
          includedDirectories,
          includedFiles,
          expandedDirectories,
          rows,
          directoryExcluded
        );
      }
    }

    return rows;
  }

  const fileExcluded = isFileExcluded(entry.path, excludedFiles, includedFiles, ancestorExcluded);
  rows.push({
    entry,
    level: entry.depth,
    parentExcluded: ancestorExcluded,
    isExcluded: fileExcluded
  });
  return rows;
};

export const SelectionPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const compressionSessionState = useCompressionSessionState();
  const isWorkflowReadOnly = isPreCompressionStepReadOnly(compressionSessionState);
  const [scanState, setScanState] = useState<ScanState>({ status: 'idle', root: null, error: null });
  const [excludedDirectories, setExcludedDirectories] = useState<Set<string>>(new Set());
  const [excludedFiles, setExcludedFiles] = useState<Set<string>>(new Set());
  const [includedDirectories, setIncludedDirectories] = useState<Set<string>>(new Set());
  const [includedFiles, setIncludedFiles] = useState<Set<string>>(new Set());
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());

  useEffect(() => {
    let isActive = true;

    const loadSourceTree = async () => {
      if (!sourceSelection) {
        setScanState({ status: 'idle', root: null, error: null });
        return;
      }

      setScanState({ status: 'loading', root: null, error: null });

      try {
        const handle = await loadFolderSelectionHandle('source');
        const snapshot = loadSourceTreeSnapshot('source');
        const persistedScope = loadSourceSelectionScope();

        let tree: ScannedDirectory | null = null;

        if (handle) {
          tree = await scanDirectoryTree(handle);
        } else if (snapshot) {
          tree = normalizeSnapshotRoot(snapshot);
        } else if (sourceSelection.path) {
          tree = await scanSourceTreeRequest(sourceSelection.path);
        }

        if (!tree) {
          throw new Error(t('selection.noTreeError'));
        }

        if (!isActive) {
          return;
        }

        setScanState({ status: 'ready', root: tree, error: null });
        setExcludedDirectories(new Set(persistedScope?.excludedDirectories ?? []));
        setExcludedFiles(new Set(persistedScope?.excludedFiles ?? []));
        setIncludedDirectories(new Set(persistedScope?.includedDirectories ?? []));
        setIncludedFiles(new Set(persistedScope?.includedFiles ?? []));
        setExpandedDirectories(new Set([...(persistedScope?.expandedDirectories ?? []), tree.path]));
        void notifyCompletion('selectionLoaded', {
          title: t('notifications.selectionLoaded.title'),
          body: t('notifications.selectionLoaded.body', { count: tree.fileCount })
        });
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : t('selection.scanError');
        setScanState({ status: 'error', root: null, error: message });
      }
    };

    void loadSourceTree();

    return () => {
      isActive = false;
    };
  }, [sourceSelection?.updatedAt]);

  const summary = useMemo(() => {
    if (scanState.status !== 'ready' || !scanState.root) {
      return null;
    }

    const rootSummary = summarizeTree(scanState.root, excludedDirectories, excludedFiles, includedDirectories, includedFiles);

    return rootSummary;
  }, [scanState, excludedDirectories, excludedFiles, includedDirectories, includedFiles]);

  const rows = useMemo(() => {
    if (scanState.status !== 'ready' || !scanState.root) {
      return [] as TreeRow[];
    }

    return flattenTree(
      scanState.root,
      excludedDirectories,
      excludedFiles,
      includedDirectories,
      includedFiles,
      expandedDirectories
    );
  }, [
    scanState,
    excludedDirectories,
    excludedFiles,
    includedDirectories,
    includedFiles,
    expandedDirectories
  ]);

  useEffect(() => {
    if (isWorkflowReadOnly || scanState.status !== 'ready' || !scanState.root) {
      return;
    }

    const sortPaths = (paths: Set<string>) => Array.from(paths).sort((left, right) => left.localeCompare(right));

    saveSourceSelectionScope({
      excludedDirectories: sortPaths(excludedDirectories),
      excludedFiles: sortPaths(excludedFiles),
      includedDirectories: sortPaths(includedDirectories),
      includedFiles: sortPaths(includedFiles),
      expandedDirectories: sortPaths(expandedDirectories)
    });
  }, [isWorkflowReadOnly, scanState, excludedDirectories, excludedFiles, includedDirectories, includedFiles, expandedDirectories]);

  const totalBytes = summary ? summary.includedBytes + summary.excludedBytes : 0;
  const totalFiles = summary ? summary.includedFiles + summary.excludedFiles : 0;
  const selectedBytes = summary?.includedBytes ?? 0;
  const selectedFiles = summary?.includedFiles ?? 0;
  const sizeRatio = totalBytes > 0 ? (selectedBytes / totalBytes) * 100 : 0;
  const fileRatio = totalFiles > 0 ? (selectedFiles / totalFiles) * 100 : 0;
  const getFileTypeLabel = (fileType: string) => {
    const normalized = fileType.toLowerCase();

    if (normalized.includes('image')) {
      return t('selection.fileType.image');
    }

    if (normalized.includes('video')) {
      return t('selection.fileType.video');
    }

    if (normalized.includes('document')) {
      return t('selection.fileType.document');
    }

    return t('selection.fileType.file');
  };

  const toggleDirectory = (path: string, isExcluded: boolean, parentExcluded: boolean) => {
    if (isWorkflowReadOnly) {
      return;
    }

    setExcludedDirectories((current) => {
      const next = new Set(current);

      if (isExcluded) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });

    setIncludedDirectories((current) => {
      const next = new Set(current);

      if (isExcluded && parentExcluded) {
        next.add(path);
      } else {
        next.delete(path);
      }

      return next;
    });
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

  const toggleFile = (path: string, isExcluded: boolean, parentExcluded: boolean) => {
    if (isWorkflowReadOnly) {
      return;
    }

    setExcludedFiles((current) => {
      const next = new Set(current);

      if (isExcluded) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });

    setIncludedFiles((current) => {
      const next = new Set(current);

      if (isExcluded && parentExcluded) {
        next.add(path);
      } else {
        next.delete(path);
      }

      return next;
    });
  };

  return (
    <div className="page-stack selection-page">
      <div className="page-header">
        <h2 className="page-title">{t('selection.title')}</h2>
        <p className="page-subtitle">{t('selection.subtitle')}</p>
        {isWorkflowReadOnly && <p className="page-summary-note compression-warning">{t('workflow.readOnlyNotice')}</p>}
      </div>

      <article className="page-card elevated selection-hero-card">
        <p className="page-section-title">{t('selection.sourceContext')}</p>
        <div className="selection-hero-row">
          <div>
            <p className="selection-hero-label">{t('selection.sourceFolder')}</p>
            <p className="selection-hero-value">{sourceSelection?.name ?? t('selection.notSelected')}</p>
          </div>
          <div>
            <p className="selection-hero-label">{t('selection.destination')}</p>
            <p className="selection-hero-value">{destinationSelection?.name ?? t('selection.notSelected')}</p>
          </div>
        </div>
        <p className="page-summary-note">{t('selection.sourceScanNote')}</p>
      </article>

      <article className="page-card elevated selection-summary-card selection-status-card">
        <div>
          <p className="page-section-title">{t('selection.statusTitle')}</p>
          <p className="page-summary-note">{t('selection.statusNote')}</p>
        </div>

        <div className="selection-summary-grid">
          <div className="selection-ratio-card">
            <p className="selection-hero-label">{t('selection.sizeRatio')}</p>
            <p className="selection-ratio-value">
              {formatBytes(selectedBytes)} / {formatBytes(totalBytes)}
            </p>
            <div className="selection-ratio-track" role="presentation">
              <span className="selection-ratio-fill" style={{ width: `${Math.min(sizeRatio, 100)}%` }} />
            </div>
          </div>

          <div className="selection-ratio-card">
            <p className="selection-hero-label">{t('selection.filesRatio')}</p>
            <p className="selection-ratio-value">
              {selectedFiles} / {totalFiles}
            </p>
            <div className="selection-ratio-track" role="presentation">
              <span className="selection-ratio-fill" style={{ width: `${Math.min(fileRatio, 100)}%` }} />
            </div>
          </div>
        </div>

        {!summary && <p className="page-summary-note">{t('selection.scanToPopulate')}</p>}
      </article>

      <article className="page-card elevated selection-tree-card">
            <div>
              <p className="page-section-title">{t('selection.sourceTree')}</p>
              <p className="page-summary-note">
                {t('selection.showingTree', { source: sourceSelection?.name ?? t('selection.selectedSource') })}
              </p>
            </div>

            {scanState.status === 'loading' && <p className="empty-note">{t('selection.scanning')}</p>}

            {scanState.status === 'error' && <p className="error">{scanState.error}</p>}

            {scanState.status === 'idle' && <p className="empty-note">{t('selection.idle')}</p>}

            {scanState.status === 'ready' && rows.length === 0 && <p className="empty-note">{t('selection.empty')}</p>}

            {scanState.status === 'ready' && rows.length > 0 && (
              <ul className="selection-tree-list">
                {rows.map((row) => {
                  if (row.entry.kind === 'directory') {
                    const isExpanded = row.isExpanded ?? false;
                    const isExpandable = row.hasChildren ?? false;

                    return (
                      <li
                        key={row.entry.path}
                        className={`selection-tree-row selection-tree-directory ${row.isExcluded ? 'is-excluded' : ''}`}
                        style={{ paddingLeft: `${12 + row.level * 18}px` }}
                      >
                        <div className="selection-tree-main">
                          {isExpandable ? (
                            <button
                              className="selection-tree-toggle"
                              type="button"
                              aria-label={t(isExpanded ? 'selection.collapse' : 'selection.expand', { name: row.entry.name })}
                              onClick={() => toggleDirectoryExpansion(row.entry.path)}
                            >
                              {isExpanded ? '-' : '+'}
                            </button>
                          ) : (
                            <span className="selection-tree-toggle-spacer" aria-hidden="true" />
                          )}

                          <label className="selection-tree-checkbox">
                            <input
                              type="checkbox"
                              checked={!row.isExcluded}
                              onChange={() => toggleDirectory(row.entry.path, row.isExcluded, row.parentExcluded)}
                              disabled={isWorkflowReadOnly}
                            />
                            <div className="selection-tree-copy">
                              <div className="selection-row-head">
                                <strong>{row.entry.name}</strong>
                                <span className="page-chip">{t('selection.folder')}</span>
                                {row.isExcluded && <span className="page-chip selection-state-chip">{t('selection.excluded')}</span>}
                              </div>
                              <p className="selection-row-note">{formatPath(row.entry.path)}</p>
                            </div>
                          </label>
                        </div>
                        <div className="selection-tree-meta">
                          <span>{t('selection.fileCount', { count: row.entry.fileCount })}</span>
                          <span>{formatBytes(row.entry.sizeBytes)}</span>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li
                      key={row.entry.path}
                      className={`selection-tree-row selection-tree-file ${row.isExcluded ? 'is-excluded' : ''}`}
                      style={{ paddingLeft: `${12 + row.level * 18}px` }}
                    >
                      <label className="selection-tree-main">
                        <input
                          type="checkbox"
                          checked={!row.isExcluded}
                          onChange={() => toggleFile(row.entry.path, row.isExcluded, row.parentExcluded)}
                          disabled={isWorkflowReadOnly}
                        />
                        <div className="selection-tree-copy">
                          <div className="selection-row-head">
                            <strong>{row.entry.name}</strong>
                            <span className="page-chip">{getFileTypeLabel(row.entry.fileType)}</span>
                            {row.isExcluded && <span className="page-chip selection-state-chip">{t('selection.excluded')}</span>}
                          </div>
                          <p className="selection-row-note">{formatPath(row.entry.path)}</p>
                        </div>
                      </label>
                      <div className="selection-tree-meta">
                        <span>{formatBytes(row.entry.sizeBytes)}</span>
                        {row.parentExcluded && <span>{t('selection.excludedByParent')}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
      </article>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button" onClick={() => navigate('/import')}>
          {t('selection.back')}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => navigate('/compression', { state: { from: '/selection' } })}
        >
          {t('selection.continue')}
        </button>
      </div>
    </div>
  );
};

export default SelectionPage;
