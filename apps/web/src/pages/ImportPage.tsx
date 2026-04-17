import { FolderPickerCard } from '../components/FolderPickerCard';
import { useFolderSelections } from '../hooks/useFolderSelections';

export const ImportPage = () => {
  const {
    sourceSelection,
    destinationSelection,
    isLoading,
    supportsNativeDirectoryPicker,
    pickSourceFolder,
    pickDestinationFolder,
    clearSourceFolder,
    clearDestinationFolder
  } = useFolderSelections();

  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Select your folders</h2>
        <p className="page-subtitle">
          Choose where your media files are stored and where you'd like the organized output to go.
        </p>
      </div>

      <div className="page-grid-2">
        <FolderPickerCard
          icon="📁"
          title="Source folder"
          description="Where your photos and videos are"
          selection={sourceSelection}
          isLoading={isLoading}
          pickLabel="Choose source folder"
          onPick={pickSourceFolder}
          onClear={clearSourceFolder}
        />

        <FolderPickerCard
          icon="📂"
          title="Destination folder"
          description="Where to save organized files"
          selection={destinationSelection}
          isLoading={isLoading}
          pickLabel="Choose destination folder"
          onPick={pickDestinationFolder}
          onClear={clearDestinationFolder}
        />
      </div>

      {!supportsNativeDirectoryPicker && (
        <div className="folder-picker-hint panel">
          <p className="page-section-title">Firefox fallback active</p>
          <p className="page-subtitle">
            Firefox does not expose the native directory picker, so the app uses the browser fallback here. If a directory is empty,
            you can paste its absolute path when prompted so we still persist the selection locally.
          </p>
        </div>
      )}

      <div className="folder-picker-hint panel">
        <p className="page-section-title">Persistence strategy</p>
        <p className="page-subtitle">
          Folder names are stored locally for fast rehydration, and native directory handles are kept in the browser when supported.
          That lets us restore the setup on the next session without forcing the user to pick everything again.
        </p>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button">
          ← Back
        </button>
        <button className="btn btn-primary" type="button">
          Continue to Preview →
        </button>
      </div>
    </div>
  );
};
