import { useEffect, useState } from 'react';
import {
  clearFolderSelection,
  getDefaultFolderSelections,
  loadFolderSelections,
  saveFolderSelection,
  type FolderSelectionSnapshot,
  type FolderSlot,
  type FolderSelectionSource
} from '../services/folder-selection.store';

type SelectionState = Record<FolderSlot, FolderSelectionSnapshot | null>;

type PickedDirectory = {
  name: string;
  source: FolderSelectionSource;
  handle?: FileSystemDirectoryHandle;
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

        cleanup();
        resolve({
          name: topLevelFolder,
          source: 'fallback'
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