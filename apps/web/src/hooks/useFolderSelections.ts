import { useEffect, useState } from 'react';
import {
  clearFolderSelection,
  getDefaultFolderSelections,
  loadFolderSelections,
  saveFolderSelection,
  type FolderSelectionSnapshot,
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

  const updateFolderPath = async (slot: FolderSlot, path: string) => {
    const nextPath = path.trim();

    if (!nextPath) {
      return;
    }

    const nextName = getFolderNameFromPath(nextPath);
    const currentSelection = selections[slot];

    if (!currentSelection) {
      const newSelection: FolderSelectionSnapshot = {
        slot,
        name: nextName,
        path: nextPath,
        updatedAt: Date.now(),
        source: 'fallback',
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

      return;
    }

    const nextSelection: FolderSelectionSnapshot = {
      ...currentSelection,
      name: nextName,
      path: nextPath,
      updatedAt: Date.now()
    };

    setSelections((currentSelections) => ({
      ...currentSelections,
      [slot]: nextSelection
    }));

    await saveFolderSelection(slot, {
      name: nextName,
      path: nextPath,
      source: currentSelection.source
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
    updateSourceFolderPath: (path: string) => updateFolderPath('source', path),
    updateDestinationFolderPath: (path: string) => updateFolderPath('destination', path),
    clearSourceFolder: () => clearFolder('source'),
    clearDestinationFolder: () => clearFolder('destination')
  };
};