import { FolderPickerCard } from '../components/FolderPickerCard';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useNavigate } from 'react-router-dom';
import { pickDirectoryRequest } from '../services/system-picker.service';
import type { FolderSlot } from '../services/folder-selection.store';

export const ImportPage = () => {
  const navigate = useNavigate();
  const {
    sourceSelection,
    destinationSelection,
    isLoading,
    updateSourceFolderPath,
    updateDestinationFolderPath,
    selectSourceFolderPath,
    selectDestinationFolderPath,
    clearSourceFolder,
    clearDestinationFolder
  } = useFolderSelections();

  const canContinue = Boolean(
    sourceSelection?.path?.trim() &&
    destinationSelection?.path?.trim()
  );

  const handleContinue = () => {
    if (!canContinue) {
      return;
    }

    navigate('/selection');
  };

  const handleBrowseFolder = async (slot: FolderSlot) => {
    const currentSelection = slot === 'source' ? sourceSelection : destinationSelection;
    const result = await pickDirectoryRequest({
      title: slot === 'source' ? 'Choose source folder' : 'Choose destination folder',
      initialPath: currentSelection?.path ?? undefined
    });

    if (result.status !== 'selected') {
      return result;
    }

    if (slot === 'source') {
      await selectSourceFolderPath({
        name: result.name,
        path: result.path,
        source: 'native'
      });
    } else {
      await selectDestinationFolderPath({
        name: result.name,
        path: result.path,
        source: 'native'
      });
    }

    return { status: 'selected' as const };
  };

  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Set up the source and destination</h2>
        <p className="page-subtitle">
          Pick the folder that contains your media and the destination that will receive the organized output.
        </p>
      </div>

      <div className="page-grid-2">
        <FolderPickerCard
          icon="📁"
          title="Source folder"
          description="Where your photos and videos are"
          selection={sourceSelection}
          isLoading={isLoading}
          onPathChange={updateSourceFolderPath}
          onBrowse={() => handleBrowseFolder('source')}
          onClear={clearSourceFolder}
        />

        <FolderPickerCard
          icon="📂"
          title="Destination folder"
          description="Where to save organized files"
          selection={destinationSelection}
          isLoading={isLoading}
          onPathChange={updateDestinationFolderPath}
          onBrowse={() => handleBrowseFolder('destination')}
          onClear={clearDestinationFolder}
        />
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-primary" type="button" onClick={handleContinue} disabled={!canContinue}>
          Continue to Selection →
        </button>
      </div>
    </div>
  );
};

export default ImportPage;
