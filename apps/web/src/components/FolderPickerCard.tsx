import React, { useEffect, useState } from 'react';
import type { FolderSelectionSnapshot } from '../services/folder-selection.store';

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
  onClear
}: FolderPickerCardProps) => {
  const [inputValue, setInputValue] = useState(selection?.path ?? '');
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [browseMessage, setBrowseMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    setInputValue(selection?.path ?? '');
  }, [selection?.path]);

  const handleInputChange = (val: string) => {
    setInputValue(val);
    setBrowseMessage(null);

    if (val.trim()) {
      onPathChange(val);
    } else {
      onClear();
    }
  };

  const handleClear = () => {
    setInputValue('');
    setBrowseMessage(null);
    onClear();
  };

  const handleBrowse = async () => {
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
        text: error instanceof Error ? error.message : 'Could not open the folder picker.'
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
            <p className="folder-picker-value">Checking saved folder...</p>
            <p className="folder-picker-meta">Loading your previous selection.</p>
          </>
        ) : (
          <>
            <p className="folder-picker-value">{selection ? selection.name : 'No folder selected yet'}</p>

            <label className="folder-picker-path-field">
              <span className="folder-picker-path-label">Path editable inline</span>
              <div className="folder-picker-input-group">
                <input
                  className="folder-picker-path-input"
                  type="text"
                  value={inputValue}
                  onChange={(event) => handleInputChange(event.target.value)}
                  placeholder="Paste absolute path here"
                />
                {selection && (
                  <button
                    className="folder-picker-clear-btn"
                    type="button"
                    aria-label="Clear folder selection"
                    onClick={handleClear}
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
                disabled={isBrowsing}
              >
                {isBrowsing ? 'Opening picker...' : `Choose ${title.toLowerCase()}`}
              </button>
            </div>

            {selection ? (
              <p className="folder-picker-meta">
                Saved {formatTimestamp(selection.updatedAt)} {selection.persisted ? '- persisted locally' : ''}
              </p>
            ) : (
              <p className="folder-picker-meta">You can paste a full absolute path and it will be saved.</p>
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
