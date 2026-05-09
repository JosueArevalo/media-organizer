import { FolderPickerCard } from '../components/FolderPickerCard';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useNavigate } from 'react-router-dom';

export const ImportPage = () => {
  const navigate = useNavigate();
  const {
    sourceSelection,
    destinationSelection,
    isLoading,
    updateSourceFolderPath,
    updateDestinationFolderPath,
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
          onClear={clearSourceFolder}
        />

        <FolderPickerCard
          icon="📂"
          title="Destination folder"
          description="Where to save organized files"
          selection={destinationSelection}
          isLoading={isLoading}
          onPathChange={updateDestinationFolderPath}
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
