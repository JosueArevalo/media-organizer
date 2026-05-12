import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFolderSelections } from '../hooks/useFolderSelections';
import {
  loadFolderSelectionHandle,
  saveSourceSelectionScope,
  loadSourceTreeSnapshot,
  type SourceTreeDirectoryNode,
  type SourceTreeNode
} from '../services/folder-selection.store';
import { scanSourceTreeRequest } from '../services/source-tree.service';

type SelectionMode = 'files' | 'directories';
type ScopePreset = 'all' | 'whatsapp' | 'camera' | 'custom';

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
    return 'Image';
  }

  if (mimeType.startsWith('video/')) {
    return 'Video';
  }

  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(extension)) {
    return 'Image';
  }

  if (['mp4', 'mov', 'm4v', 'avi', 'mkv'].includes(extension)) {
    return 'Video';
  }

  if (['pdf', 'doc', 'docx', 'txt'].includes(extension)) {
    return 'Document';
  }

  return 'File';
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
  includeFiles: boolean,
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
        if (child.kind === 'file' && !includeFiles) {
          continue;
        }

        flattenTree(
          child,
          excludedDirectories,
          excludedFiles,
          includedDirectories,
          includedFiles,
          expandedDirectories,
          includeFiles,
          rows,
          directoryExcluded
        );
      }
    }

    return rows;
  }

  const fileExcluded = isFileExcluded(entry.path, excludedFiles, includedFiles, ancestorExcluded);
  rows.push({ entry, level: entry.depth, parentExcluded: ancestorExcluded, isExcluded: fileExcluded });
  return rows;
};

const applyPreset = (root: ScannedDirectory, preset: ScopePreset) => {
  const excludedDirectories = new Set<string>();
  const excludedFiles = new Set<string>();
  const includedDirectories = new Set<string>();
  const includedFiles = new Set<string>();

  if (preset === 'all') {
    return { excludedDirectories, excludedFiles, includedDirectories, includedFiles };
  }

  const normalizedRoot = formatPath(root.path).toLowerCase();

  const shouldExcludeByPath = (path: string) => {
    const normalizedPath = formatPath(path).toLowerCase();

    if (preset === 'whatsapp') {
      return normalizedPath.includes('whatsapp') || normalizedPath.includes('screenshots');
    }

    if (preset === 'camera') {
      return (
        normalizedPath.includes('whatsapp') ||
        normalizedPath.includes('screenshots') ||
        normalizedPath.includes('download') ||
        normalizedPath.includes('screen recording') ||
        normalizedPath.includes('screen-recording') ||
        normalizedPath.includes('edited')
      );
    }

    return false;
  };

  const visit = (entry: SourceEntry, ancestorExcluded = false) => {
    if (entry.kind === 'directory') {
      const isExcluded = ancestorExcluded || shouldExcludeByPath(entry.path);

      if (isExcluded && entry.path.toLowerCase() !== normalizedRoot) {
        excludedDirectories.add(entry.path);
      }

      for (const child of entry.children) {
        visit(child, isExcluded);
      }

      return;
    }

    if (ancestorExcluded || shouldExcludeByPath(entry.path)) {
      excludedFiles.add(entry.path);
    }
  };

  visit(root);
  return { excludedDirectories, excludedFiles, includedDirectories, includedFiles };
};

export const SelectionPage = () => {
  const navigate = useNavigate();
  const { sourceSelection, destinationSelection } = useFolderSelections();
  const [scanState, setScanState] = useState<ScanState>({ status: 'idle', root: null, error: null });
  const [mode, setMode] = useState<SelectionMode>('files');
  const [activePreset, setActivePreset] = useState<ScopePreset>('all');
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

        let tree: ScannedDirectory | null = null;

        if (handle) {
          tree = await scanDirectoryTree(handle);
        } else if (snapshot) {
          tree = normalizeSnapshotRoot(snapshot);
        } else if (sourceSelection.path) {
          tree = await scanSourceTreeRequest(sourceSelection.path);
        }

        if (!tree) {
          throw new Error('No source tree is available yet. Re-select the source folder from Import to inspect its contents.');
        }

        if (!isActive) {
          return;
        }

        setScanState({ status: 'ready', root: tree, error: null });
        setExcludedDirectories(new Set());
        setExcludedFiles(new Set());
        setIncludedDirectories(new Set());
        setIncludedFiles(new Set());
        setExpandedDirectories(new Set([tree.path]));
        setActivePreset('all');
        setMode('files');
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Could not scan the selected source folder.';
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
      expandedDirectories,
      mode === 'files'
    );
  }, [scanState, excludedDirectories, excludedFiles, includedDirectories, includedFiles, expandedDirectories, mode]);

  useEffect(() => {
    if (scanState.status !== 'ready' || !scanState.root) {
      return;
    }

    const sortPaths = (paths: Set<string>) => Array.from(paths).sort((left, right) => left.localeCompare(right));

    saveSourceSelectionScope({
      excludedDirectories: sortPaths(excludedDirectories),
      excludedFiles: sortPaths(excludedFiles),
      includedDirectories: sortPaths(includedDirectories),
      includedFiles: sortPaths(includedFiles)
    });
  }, [scanState, excludedDirectories, excludedFiles, includedDirectories, includedFiles]);

  const totalBytes = summary ? summary.includedBytes + summary.excludedBytes : 0;
  const totalFiles = summary ? summary.includedFiles + summary.excludedFiles : 0;
  const selectedBytes = summary?.includedBytes ?? 0;
  const selectedFiles = summary?.includedFiles ?? 0;
  const sizeRatio = totalBytes > 0 ? (selectedBytes / totalBytes) * 100 : 0;
  const fileRatio = totalFiles > 0 ? (selectedFiles / totalFiles) * 100 : 0;

  const handlePreset = (preset: ScopePreset) => {
    setActivePreset(preset);

    if (scanState.status !== 'ready' || !scanState.root) {
      return;
    }

    const nextSelection = applyPreset(scanState.root, preset);
    setExcludedDirectories(nextSelection.excludedDirectories);
    setExcludedFiles(nextSelection.excludedFiles);
    setIncludedDirectories(nextSelection.includedDirectories);
    setIncludedFiles(nextSelection.includedFiles);
  };

  const toggleDirectory = (path: string, isExcluded: boolean, parentExcluded: boolean) => {
    setActivePreset('custom');

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
    setActivePreset('custom');

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
        <h2 className="page-title">Select what gets compressed</h2>
        <p className="page-subtitle">
          This panel shows the real source tree that was selected in Import. You can exclude whole directories or fine-tune individual
          files, with a list-first view so size and origin stay visible.
        </p>
      </div>

      <div className="selection-top-grid">
        <article className="page-card elevated selection-hero-card">
          <p className="page-section-title">Source context</p>
          <div className="selection-hero-row">
            <div>
              <p className="selection-hero-label">Source folder</p>
              <p className="selection-hero-value">{sourceSelection?.name ?? 'Not selected yet'}</p>
            </div>
            <div>
              <p className="selection-hero-label">Destination</p>
              <p className="selection-hero-value">{destinationSelection?.name ?? 'Not selected yet'}</p>
            </div>
          </div>
          <p className="page-summary-note">
            The source scan is loaded from a stored directory handle when available, or from backend path-based scanning when using
            manual absolute paths.
          </p>
        </article>

        <article className="page-card elevated selection-hero-card">
          <p className="page-section-title">Scope presets</p>
          <div className="page-pill-row">
            <button className={`selection-pill ${activePreset === 'all' ? 'is-active' : ''}`} type="button" onClick={() => handlePreset('all')}>
              Keep everything
            </button>
            <button
              className={`selection-pill ${activePreset === 'whatsapp' ? 'is-active' : ''}`}
              type="button"
              onClick={() => handlePreset('whatsapp')}
            >
              Exclude WhatsApp + screenshots
            </button>
            <button
              className={`selection-pill ${activePreset === 'camera' ? 'is-active' : ''}`}
              type="button"
              onClick={() => handlePreset('camera')}
            >
              Camera focused
            </button>
            <button
              className={`selection-pill ${activePreset === 'custom' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setActivePreset('custom')}
            >
              Custom
            </button>
          </div>
          <p className="page-summary-note">
            Presets are only a starting point. The user can still toggle specific folders or files afterwards.
          </p>
        </article>
      </div>

      <div className="selection-layout">
        <section className="selection-main-column">
          <div className="page-card selection-toolbar">
            <div>
              <p className="page-section-title">Selection mode</p>
              <p className="page-summary-note">Directory mode is lighter. File mode shows the full real tree from the source folder.</p>
            </div>
            <div className="selection-mode-toggle" role="tablist" aria-label="Selection mode">
              <button
                className={`selection-mode-btn ${mode === 'files' ? 'is-active' : ''}`}
                type="button"
                onClick={() => setMode('files')}
              >
                Files
              </button>
              <button
                className={`selection-mode-btn ${mode === 'directories' ? 'is-active' : ''}`}
                type="button"
                onClick={() => setMode('directories')}
              >
                Directories
              </button>
            </div>
          </div>

          <article className="page-card elevated selection-tree-card">
            <div className="selection-tree-header">
              <div>
                <p className="page-section-title">Source tree</p>
                <p className="page-summary-note">
                  Showing {mode === 'files' ? 'directories and files' : 'directories only'} from {sourceSelection?.name ?? 'the selected source'}.
                </p>
              </div>
              <div className="selection-tree-key">
                <span className="page-chip">Folder</span>
                <span className="page-chip">File</span>
                <span className="page-chip">Size</span>
              </div>
            </div>

            {scanState.status === 'loading' && <p className="empty-note">Scanning the real directory tree...</p>}

            {scanState.status === 'error' && <p className="error">{scanState.error}</p>}

            {scanState.status === 'idle' && <p className="empty-note">Choose a source folder in Import to inspect its contents here.</p>}

            {scanState.status === 'ready' && rows.length === 0 && <p className="empty-note">No entries found in the selected source folder.</p>}

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
                              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.entry.name}`}
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
                            />
                            <div className="selection-tree-copy">
                              <div className="selection-row-head">
                                <strong>{row.entry.name}</strong>
                                <span className="page-chip">Folder</span>
                                {row.isExcluded && <span className="page-chip selection-state-chip">Excluded</span>}
                              </div>
                              <p className="selection-row-note">{formatPath(row.entry.path)}</p>
                            </div>
                          </label>
                        </div>
                        <div className="selection-tree-meta">
                          <span>{row.entry.fileCount} files</span>
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
                        />
                        <div className="selection-tree-copy">
                          <div className="selection-row-head">
                            <strong>{row.entry.name}</strong>
                            <span className="page-chip">{row.entry.fileType}</span>
                            {row.isExcluded && <span className="page-chip selection-state-chip">Excluded</span>}
                          </div>
                          <p className="selection-row-note">{formatPath(row.entry.path)}</p>
                        </div>
                      </label>
                      <div className="selection-tree-meta">
                        <span>{formatBytes(row.entry.sizeBytes)}</span>
                        <span>{row.parentExcluded ? 'Excluded by parent' : 'File-level toggle'}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </section>

        <aside className="selection-side-column">
          <article className="page-card elevated selection-summary-card selection-status-card">
            <p className="page-section-title">Selection status</p>
            <p className="page-summary-note">Minimal status view focused on the two key ratios.</p>

            <div className="selection-ratio-card">
              <p className="selection-hero-label">Size selected / total</p>
              <p className="selection-ratio-value">
                {formatBytes(selectedBytes)} / {formatBytes(totalBytes)}
              </p>
              <div className="selection-ratio-track" role="presentation">
                <span className="selection-ratio-fill" style={{ width: `${Math.min(sizeRatio, 100)}%` }} />
              </div>
            </div>

            <div className="selection-ratio-card">
              <p className="selection-hero-label">Files selected / total</p>
              <p className="selection-ratio-value">
                {selectedFiles} / {totalFiles}
              </p>
              <div className="selection-ratio-track" role="presentation">
                <span className="selection-ratio-fill" style={{ width: `${Math.min(fileRatio, 100)}%` }} />
              </div>
            </div>

            {!summary && <p className="page-summary-note">Scan the source tree to populate the status ratios.</p>}
          </article>
        </aside>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button" onClick={() => navigate('/import')}>
          ← Back
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => navigate('/compression', { state: { from: '/selection' } })}
        >
          Continue to Compression →
        </button>
      </div>
    </div>
  );
};

export default SelectionPage;