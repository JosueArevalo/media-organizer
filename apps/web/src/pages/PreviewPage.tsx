export const PreviewPage = () => {
  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Review and select items</h2>
        <p className="page-subtitle">
          Here you can preview detected media, apply bulk selections, and adjust classifications before processing.
        </p>
      </div>

      <div className="page-card">
        <div className="page-option-list">
          <label className="page-option">
            <input type="checkbox" />
            <span className="page-option-label">
              <strong>Select all items</strong>
            </span>
          </label>
          <label className="page-option">
            <input type="checkbox" />
            <span className="page-option-label">Select only large files (&gt;5MB)</span>
          </label>
          <label className="page-option">
            <input type="checkbox" />
            <span className="page-option-label">Exclude WhatsApp/Screenshots</span>
          </label>
        </div>
      </div>

      <div className="page-card elevated">
        <p className="page-section-title">Detected items (mock data)</p>
        <ul className="page-list">
          {[
            { type: 'Photo', source: 'Camera', size: '3.2 MB', selected: true },
            { type: 'Photo', source: 'Screenshot', size: '1.1 MB', selected: false },
            { type: 'Video', source: 'Camera', size: '125.4 MB', selected: true }
          ].map((item, i) => (
            <li
              key={i}
              className={`page-list-row ${item.selected ? 'is-selected' : ''}`}
            >
              <div className="page-list-row-left">
                <input type="checkbox" defaultChecked={item.selected} />
                <span className="page-option-label">
                  <strong>{item.type}</strong>
                </span>
                <span className="page-chip">
                  {item.source}
                </span>
              </div>
              <span className="page-option-label">{item.size}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button">
          ← Back
        </button>
        <button className="btn btn-primary" type="button">
          Continue to Compression →
        </button>
      </div>
    </div>
  );
};
