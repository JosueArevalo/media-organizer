import type { FolderSelectionSnapshot } from '../services/folder-selection.store';

type FolderPickerCardProps = {
  icon: string;
  title: string;
  description: string;
  selection: FolderSelectionSnapshot | null;
  isLoading: boolean;
  pickLabel: string;
  onPick: () => void;
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
  pickLabel,
  onPick,
  onClear
}: FolderPickerCardProps) => {
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
        ) : selection ? (
          <>
            <p className="folder-picker-value">{selection.name}</p>
            <p className="folder-picker-meta">
              Saved {formatTimestamp(selection.updatedAt)} {selection.persisted ? '• persisted locally' : ''}
            </p>
          </>
        ) : (
          <>
            <p className="folder-picker-value">No folder selected yet</p>
            <p className="folder-picker-meta">Choose a directory to keep this setup ready for the next session.</p>
          </>
        )}
      </div>

      <div className="folder-picker-actions">
        <button className="btn btn-secondary folder-picker-button" type="button" onClick={onPick}>
          {pickLabel}
        </button>
        {selection && (
          <button className="btn btn-ghost folder-picker-button" type="button" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </section>
  );
};