import { useNavigate } from 'react-router-dom';
import { FolderPickerCard } from '../components/FolderPickerCard';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useTranslation } from '../i18n';
import { pickDirectoryRequest } from '../services/system-picker.service';
import type { FolderSlot } from '../services/folder-selection.store';

export const ImportPage = () => {
  const { t } = useTranslation();
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
      title: slot === 'source' ? t('import.chooseSourceDialog') : t('import.chooseDestinationDialog'),
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
        <h2 className="page-title">{t('import.title')}</h2>
        <p className="page-subtitle">{t('import.subtitle')}</p>
      </div>

      <div className="page-grid-2">
        <FolderPickerCard
          icon="📁"
          title={t('import.source.title')}
          description={t('import.source.description')}
          selection={sourceSelection}
          isLoading={isLoading}
          onPathChange={updateSourceFolderPath}
          onBrowse={() => handleBrowseFolder('source')}
          onClear={clearSourceFolder}
        />

        <FolderPickerCard
          icon="📂"
          title={t('import.destination.title')}
          description={t('import.destination.description')}
          selection={destinationSelection}
          isLoading={isLoading}
          onPathChange={updateDestinationFolderPath}
          onBrowse={() => handleBrowseFolder('destination')}
          onClear={clearDestinationFolder}
        />
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-primary" type="button" onClick={handleContinue} disabled={!canContinue}>
          {t('import.continue')}
        </button>
      </div>
    </div>
  );
};

export default ImportPage;
