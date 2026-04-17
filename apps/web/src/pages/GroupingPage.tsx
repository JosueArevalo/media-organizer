export const GroupingPage = () => {
  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Structure your output</h2>
        <p className="page-subtitle">
          Review and customize how your media will be organized into folders. Edit names and groupings as needed.
        </p>
      </div>

      <div className="page-card">
        <p className="page-section-title">Proposed folder structure (mock)</p>
        <ul className="page-folder-list">
          {[
            { name: '2026.04 - Spring Cleanup', items: 342 },
            { name: '2026.03 - Family Event', items: 156 },
            { name: '2026.02 - Vacation', items: 284 },
            { name: '2026.01 - Misc', items: 560 }
          ].map((folder, i) => (
            <li key={i} className="page-folder-row">
              <div className="page-folder-card">
                <span aria-hidden="true" style={{ fontSize: '14px' }}>📁</span>
                <div className="page-folder-meta">
                  <p className="page-folder-title">{folder.name}</p>
                  <p className="page-folder-subtitle">{folder.items} files</p>
                </div>
              </div>
              <button className="page-edit-btn" type="button">
                Edit
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="page-card">
        <label className="page-option">
          <input type="checkbox" defaultChecked />
          <span className="page-option-label">
            <strong>
              Auto-rename folders with consistent naming pattern
            </strong>
          </span>
        </label>
        <p className="page-summary-note">Uses pattern: YYYY.MM - Event Name</p>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button">
          ← Back
        </button>
        <button className="btn btn-primary" type="button">
          Apply and Start Processing
        </button>
      </div>
    </div>
  );
};

export default GroupingPage;
