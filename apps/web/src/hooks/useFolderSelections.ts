import { useEffect, useState } from 'react';
import {
  clearFolderSelection,
  clearSourceTreeSnapshot,
  getDefaultFolderSelections,
  loadFolderSelections,
  saveSourceTreeSnapshot,
  saveFolderSelection,
  type FolderSelectionSnapshot,
  type FolderSlot,
  type FolderSelectionSource,
  type SourceTreeDirectoryNode
} from '../services/folder-selection.store';

type SelectionState = Record<FolderSlot, FolderSelectionSnapshot | null>;

type PickedDirectory = {
  name: string;
  source: FolderSelectionSource;
  handle?: FileSystemDirectoryHandle;
  treeSnapshot?: SourceTreeDirectoryNode;
};

const getDirectoryPicker = () => {
  const nativeWindow = window as Window & {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };

  return nativeWindow.showDirectoryPicker;
};

const askForFolderPath = (slot: FolderSlot) => {
  const label = slot === 'source' ? 'source' : 'destination';
  const enteredPath = window.prompt(
    `This browser cannot read empty ${label} folders directly. Paste the full folder path to keep it saved locally:`,
    ''
  );

  return enteredPath?.trim() || null;
};

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

type TreeBuilderFile = {
  kind: 'file';
  name: string;
  path: string;
  sizeBytes: number;
  fileType: string;
};

type TreeBuilderDirectory = {
  kind: 'directory';
  name: string;
  path: string;
  children: Map<string, TreeBuilderDirectory | TreeBuilderFile>;
};

const createDirectoryNode = (name: string, path: string): TreeBuilderDirectory => ({
  kind: 'directory',
  name,
  path,
  children: new Map()
});

const finalizeDirectoryNode = (node: TreeBuilderDirectory): SourceTreeDirectoryNode => {
  const children = Array.from(node.children.values()).map((child) =>
    child.kind === 'directory' ? finalizeDirectoryNode(child) : child
  );

  const summary = children.reduce(
    (accumulator, child) => {
      accumulator.sizeBytes += child.sizeBytes;

      if (child.kind === 'file') {
        accumulator.fileCount += 1;
      } else {
        accumulator.fileCount += child.fileCount;
        accumulator.directoryCount += 1 + child.directoryCount;
      }

      return accumulator;
    },
    { sizeBytes: 0, fileCount: 0, directoryCount: 0 }
  );

  return {
    kind: 'directory',
    name: node.name,
    path: node.path,
    sizeBytes: summary.sizeBytes,
    fileCount: summary.fileCount,
    directoryCount: summary.directoryCount,
    children
  };
};

const buildFallbackTreeSnapshot = (files: File[]): SourceTreeDirectoryNode | null => {
  if (files.length === 0) {
    return null;
  }

  const rootName = files[0].webkitRelativePath.split('/')[0] || files[0].name;
  const root = createDirectoryNode(rootName, rootName);

  for (const file of files) {
    const segments = file.webkitRelativePath.split('/').filter(Boolean);
    const fileName = segments[segments.length - 1] || file.name;
    const folderSegments = segments.slice(1, -1);

    let currentNode = root;
    let currentPath = rootName;

    for (const segment of folderSegments) {
      currentPath = `${currentPath}/${segment}`;

      let childNode = currentNode.children.get(segment);

      if (!childNode || childNode.kind !== 'directory') {
        childNode = createDirectoryNode(segment, currentPath);
        currentNode.children.set(segment, childNode);
      }

      currentNode = childNode;
    }

    const filePath = `${rootName}/${segments.slice(1).join('/') || fileName}`;
    currentNode.children.set(fileName, {
      kind: 'file',
      name: fileName,
      path: filePath,
      sizeBytes: file.size,
      fileType: getFileType(fileName, file.type)
    });
  }

  return finalizeDirectoryNode(root);
};

const pickDirectoryWithFallback = async (slot: FolderSlot): Promise<PickedDirectory | null> => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
  input.style.display = 'none';

  return new Promise((resolve) => {
    const cleanup = () => {
      input.remove();
    };

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);

      if (files.length > 0) {
        const topLevelFolder = files[0].webkitRelativePath.split('/')[0] || files[0].name;
        const treeSnapshot = buildFallbackTreeSnapshot(files);

        cleanup();
        resolve({
          name: topLevelFolder,
          source: 'fallback',
          treeSnapshot: treeSnapshot ?? undefined
        });
        return;
      }

      cleanup();

      const manualPath = askForFolderPath(slot);

      if (!manualPath) {
        resolve(null);
        return;
      }

      resolve({
        name: manualPath,
        source: 'fallback'
      });
    });

    document.body.appendChild(input);
    input.click();
  });
};

const pickDirectory = async (slot: FolderSlot): Promise<PickedDirectory | null> => {
  const nativePicker = getDirectoryPicker();

  if (nativePicker) {
    try {
      const handle = await nativePicker({ mode: slot === 'destination' ? 'readwrite' : 'read' });

      return {
        name: handle.name,
        source: 'native',
        handle
      };
    } catch {
      return null;
    }
  }

  return pickDirectoryWithFallback(slot);
};

export const useFolderSelections = () => {
  const [selections, setSelections] = useState<SelectionState>(getDefaultFolderSelections);
  const [isLoading, setIsLoading] = useState(true);
  const [supportsNativeDirectoryPicker, setSupportsNativeDirectoryPicker] = useState(false);

  useEffect(() => {
    let isActive = true;

    setSupportsNativeDirectoryPicker(typeof window !== 'undefined' && 'showDirectoryPicker' in window);

    loadFolderSelections()
      .then((loadedSelections) => {
        if (isActive) {
          setSelections(loadedSelections);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const pickFolder = async (slot: FolderSlot) => {
    const pickedDirectory = await pickDirectory(slot);

    if (!pickedDirectory) {
      return;
    }

    const selection = {
      slot,
      name: pickedDirectory.name,
      updatedAt: Date.now(),
      source: pickedDirectory.source,
      persisted: true
    } as FolderSelectionSnapshot;

    setSelections((currentSelections) => ({
      ...currentSelections,
      [slot]: selection
    }));

    await saveFolderSelection(slot, {
      name: pickedDirectory.name,
      source: pickedDirectory.source,
      handle: pickedDirectory.handle
    });

    if (slot === 'source') {
      if (pickedDirectory.source === 'fallback' && pickedDirectory.treeSnapshot) {
        saveSourceTreeSnapshot('source', pickedDirectory.treeSnapshot);
      }

      if (pickedDirectory.source === 'native') {
        clearSourceTreeSnapshot('source');
      }
    }
  };

  const clearFolder = async (slot: FolderSlot) => {
    setSelections((currentSelections) => ({
      ...currentSelections,
      [slot]: null
    }));

    await clearFolderSelection(slot);
  };

  return {
    sourceSelection: selections.source,
    destinationSelection: selections.destination,
    isLoading,
    supportsNativeDirectoryPicker,
    pickSourceFolder: () => pickFolder('source'),
    pickDestinationFolder: () => pickFolder('destination'),
    clearSourceFolder: () => clearFolder('source'),
    clearDestinationFolder: () => clearFolder('destination')
  };
};