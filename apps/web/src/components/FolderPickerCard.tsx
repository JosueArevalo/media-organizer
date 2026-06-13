import React, { useEffect, useState } from 'react';
import type { FolderSelectionSnapshot } from '../services/folder-selection.store';
import { useTranslation } from '../i18n';

export type FolderBrowseResult =
  | { status: 'selected' }
  | { status: 'cancelled' }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

type FolderPickerCardProps = {
  icon: string;
  title: string;
  description: string;
  selection: FolderSelectionSnapshot | null;
  isLoading: boolean;
  onPathChange: (path: string) => void;
  onBrowse: () => Promise<FolderBrowseResult>;
  onClear: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  onPathInputKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  isReadOnly?: boolean;
};

const formatTimestamp = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp);

export const FolderPickerCard = ({
  icon,
  title,
  description,
  selection,
  isLoading,
  onPathChange,
  onBrowse,
  onClear,
  inputRef,
  onPathInputKeyDown,
  isReadOnly = false
}: FolderPickerCardProps) => {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState(selection?.path ?? '');
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browseMessage, setBrowseMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    setInputValue(selection?.path ?? '');
  }, [selection?.path]);

  const handleInputChange = (val: string) => {
    if (isReadOnly) {
      return;
    }

    setInputValue(val);
    setBrowseMessage(null);

    if (val.trim()) {
      onPathChange(val);
    } else {
      onClear();
    }
  };

  const handleClear = () => {
    if (isReadOnly) {
      return;
    }

    setInputValue('');
    setBrowseMessage(null);
    onClear();
  };

  const handleBrowse = async () => {
    if (isReadOnly) {
      return;
    }

    setIsBrowsing(true);
    setBrowseMessage(null);

    try {
      const result = await onBrowse();

      if (result.status === 'unsupported' || result.status === 'error') {
        setBrowseMessage({
          type: 'error',
          text: result.message
        });
      }
    } catch (error) {
      setBrowseMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('folder.pickerError')
      });
    } finally {
      setIsBrowsing(false);
    }
  };

  return (
    <section className="page-card folder-picker-card">
      <div className="page-icon-badge" aria-hidden="true">
        {icon}
      </div>
      <h3 className="page-section-title">{title}</h3>
      <p className="page-summary-note">{description}</p>

      <div className="folder-picker-selection" aria-live="polite">
        {isLoading ? (
          <>
            <p className="folder-picker-value">{t('folder.loadingValue')}</p>
            <p className="folder-picker-meta">{t('folder.loadingMeta')}</p>
          </>
        ) : (
          <>
            <p className="folder-picker-value">{selection ? selection.name : t('folder.noneSelected')}</p>

            <label className="folder-picker-path-field">
              <span className="folder-picker-path-label">{t('folder.pathLabel')}</span>
              <div className="folder-picker-input-group">
                <input
                  ref={inputRef}
                  className="folder-picker-path-input"
                  type="text"
                  value={inputValue}
                  onChange={(event) => handleInputChange(event.target.value)}
                  onKeyDown={onPathInputKeyDown}
                  placeholder={t('folder.pathPlaceholder')}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                />
                {selection && (
                  <button
                    className="folder-picker-clear-btn"
                    type="button"
                    aria-label={t('folder.clearAria')}
                    onClick={handleClear}
                    disabled={isReadOnly}
                  >
                    x
                  </button>
                )}
              </div>
            </label>

            <div className="folder-picker-actions">
              <button
                className="btn btn-secondary folder-picker-button"
                type="button"
                onClick={() => void handleBrowse()}
                disabled={isBrowsing || isReadOnly}
              >
                {isBrowsing ? t('folder.openingPicker') : t('folder.choose', { title: title.toLowerCase() })}
              </button>
            </div>

            {selection ? (
              <p className="folder-picker-meta">
                {t('folder.saved', {
                  date: formatTimestamp(selection.updatedAt),
                  persisted: selection.persisted ? t('folder.persisted') : ''
                })}
              </p>
            ) : (
              <p className="folder-picker-meta">{t('folder.pathHint')}</p>
            )}

            {browseMessage && (
              <p className={`folder-picker-message folder-picker-message-${browseMessage.type}`}>
                {browseMessage.text}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
};
