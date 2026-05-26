import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPickerCard } from '../components/FolderPickerCard';
import { useFolderSelections } from '../hooks/useFolderSelections';
import { useTranslation, type TranslationKey } from '../i18n';
import { pickDirectoryRequest } from '../services/system-picker.service';
import type { FolderSlot } from '../services/folder-selection.store';
import {
  validateImportFoldersLocally,
  validateImportFoldersRequest,
  type ImportValidationCode
} from '../services/import-validation.service';

const validationMessageKeys: Record<ImportValidationCode, TranslationKey> = {
  missing_paths: 'import.validation.missingPaths',
  relative_source: 'import.validation.relativeSource',
  relative_destination: 'import.validation.relativeDestination',
  same_path: 'import.validation.samePath',
  destination_inside_source: 'import.validation.destinationInsideSource',
  source_not_found: 'import.validation.sourceNotFound',
  source_not_directory: 'import.validation.sourceNotDirectory',
  source_not_readable: 'import.validation.sourceNotReadable',
  destination_parent_not_found: 'import.validation.destinationParentNotFound',
  destination_not_directory: 'import.validation.destinationNotDirectory',
  destination_not_writable: 'import.validation.destinationNotWritable',
  request_failed: 'import.validation.requestFailed'
};

export const ImportPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sourcePathInputRef = useRef<HTMLInputElement>(null);
  const destinationPathInputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
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

  const sourcePath = sourceSelection?.path?.trim() ?? '';
  const destinationPath = destinationSelection?.path?.trim() ?? '';
  const localValidation = useMemo(
    () => validateImportFoldersLocally(sourcePath, destinationPath),
    [sourcePath, destinationPath]
  );
  const canContinue = Boolean(
    sourcePath &&
    destinationPath &&
    localValidation.ok &&
    !isValidating
  );

  const getValidationMessage = (code: ImportValidationCode, fallback: string) =>
    validationMessageKeys[code] ? t(validationMessageKeys[code]) : fallback;
  const localValidationError = sourcePath && destinationPath && !localValidation.ok
    ? getValidationMessage(localValidation.code, localValidation.message)
    : null;
  const displayedValidationError = validationError ?? localValidationError;

  useEffect(() => {
    setValidationError(null);
  }, [sourcePath, destinationPath]);

  const handleContinue = async () => {
    setValidationError(null);

    if (!localValidation.ok) {
      setValidationError(getValidationMessage(localValidation.code, localValidation.message));
      return;
    }

    if (!canContinue) {
      return;
    }

    setIsValidating(true);

    try {
      const backendValidation = await validateImportFoldersRequest(sourcePath, destinationPath);

      if (!backendValidation.ok) {
        setValidationError(getValidationMessage(backendValidation.code, backendValidation.message));
        return;
      }

      navigate('/selection');
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : t('import.validation.requestFailed'));
    } finally {
      setIsValidating(false);
    }
  };

  const handleSourcePathInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) {
      return;
    }

    const destinationPathInput = destinationPathInputRef.current;

    if (!destinationPathInput) {
      return;
    }

    event.preventDefault();
    destinationPathInput.focus();
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

    setValidationError(null);

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
          inputRef={sourcePathInputRef}
          onPathInputKeyDown={handleSourcePathInputKeyDown}
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
          inputRef={destinationPathInputRef}
        />
      </div>

      <div className="page-footer-actions">
        <div className="import-validation-status" aria-live="polite">
          {displayedValidationError && (
            <p className="folder-picker-message folder-picker-message-error">
              {displayedValidationError}
            </p>
          )}
        </div>
        <button className="btn btn-primary" type="button" onClick={() => void handleContinue()} disabled={!canContinue}>
          {isValidating ? t('import.validation.validating') : t('import.continue')}
        </button>
      </div>
    </div>
  );
};

export default ImportPage;
