export const ImportPage = () => {
  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Select your folders</h2>
        <p className="page-subtitle">
          Choose where your media files are stored and where you'd like the organized output to go.
        </p>
      </div>

      <div className="page-grid-2">
        <div className="page-card">
          <div className="page-icon-badge">📁</div>
          <h3 className="page-section-title">Source folder</h3>
          <p className="page-summary-note">Where your photos and videos are</p>
          <button className="btn btn-secondary page-button" type="button">
            Choose folder
          </button>
        </div>

        <div className="page-card">
          <div className="page-icon-badge">📂</div>
          <h3 className="page-section-title">Destination folder</h3>
          <p className="page-summary-note">Where to save organized files</p>
          <button className="btn btn-secondary page-button" type="button">
            Choose folder
          </button>
        </div>
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
