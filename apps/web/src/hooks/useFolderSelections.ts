import { useEffect, useState } from 'react';
import {
  clearFolderSelection,
  clearSourceSelectionScope,
  clearSourceTreeSnapshot,
  getDefaultFolderSelections,
  loadFolderSelections,
  saveFolderSelection,
  type FolderSelectionSnapshot,
  type FolderSelectionSource,
  type FolderSlot
} from '../services/folder-selection.store';

type SelectionState = Record<FolderSlot, FolderSelectionSnapshot | null>;

const getFolderNameFromPath = (folderPath: string) => {
  const normalized = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);

  return segments[segments.length - 1] || folderPath;
};

export const useFolderSelections = () => {
  const [selections, setSelections] = useState<SelectionState>(getDefaultFolderSelections);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

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

  const saveFolderPath = async (slot: FolderSlot, path: string, source: FolderSelectionSource, name?: string) => {
    const nextPath = path.trim();

    if (!nextPath) {
      return;
    }

    const nextName = name?.trim() || getFolderNameFromPath(nextPath);
    const currentSelection = selections[slot];

    if (!currentSelection) {
      const newSelection: FolderSelectionSnapshot = {
        slot,
        name: nextName,
        path: nextPath,
        updatedAt: Date.now(),
        source,
        persisted: true
      } as FolderSelectionSnapshot;

      setSelections((currentSelections) => ({
        ...currentSelections,
        [slot]: newSelection
      }));

      await saveFolderSelection(slot, {
        name: newSelection.name,
        path: newSelection.path,
        source: newSelection.source
      });

      if (slot === 'source') {
        clearSourceTreeSnapshot('source');
        clearSourceSelectionScope();
      }

      return;
    }

    const nextSelection: FolderSelectionSnapshot = {
      ...currentSelection,
      name: nextName,
      path: nextPath,
      source,
      updatedAt: Date.now()
    };

    setSelections((currentSelections) => ({
      ...currentSelections,
      [slot]: nextSelection
    }));

    await saveFolderSelection(slot, {
      name: nextName,
      path: nextPath,
      source
    });

    if (slot === 'source') {
      clearSourceTreeSnapshot('source');
      clearSourceSelectionScope();
    }
  };

  const updateFolderPath = async (slot: FolderSlot, path: string) => {
    await saveFolderPath(slot, path, 'fallback');
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
    updateSourceFolderPath: (path: string) => updateFolderPath('source', path),
    updateDestinationFolderPath: (path: string) => updateFolderPath('destination', path),
    selectSourceFolderPath: (selection: { name: string; path: string; source: FolderSelectionSource }) =>
      saveFolderPath('source', selection.path, selection.source, selection.name),
    selectDestinationFolderPath: (selection: { name: string; path: string; source: FolderSelectionSource }) =>
      saveFolderPath('destination', selection.path, selection.source, selection.name),
    clearSourceFolder: () => clearFolder('source'),
    clearDestinationFolder: () => clearFolder('destination')
  };
};
