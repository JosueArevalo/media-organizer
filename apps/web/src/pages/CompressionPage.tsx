export const CompressionPage = () => {
  return (
    <div className="page-stack">
      <div className="page-header">
        <h2 className="page-title">Optimize your media</h2>
        <p className="page-subtitle">
          Choose compression profiles for images and videos to reduce file size while maintaining quality.
        </p>
      </div>

      <div className="page-grid-2">
        <div className="page-card">
          <h3 className="page-section-title">📸 Image compression</h3>
          <p className="page-summary-note">mozjpeg profiles</p>

          <div className="page-option-list">
            <label className="page-option">
              <input type="radio" name="image" defaultChecked />
              <span className="page-option-label">
                <strong>Balanced</strong> (80% quality)
              </span>
            </label>
            <label className="page-option">
              <input type="radio" name="image" />
              <span className="page-option-label">
                <strong>High</strong> (90% quality)
              </span>
            </label>
            <label className="page-option">
              <input type="radio" name="image" />
              <span className="page-option-label">
                <strong>Aggressive</strong> (70% quality)
              </span>
            </label>
          </div>
        </div>

        <div className="page-card">
          <h3 className="page-section-title">🎬 Video compression</h3>
          <p className="page-summary-note">HandBrake presets</p>

          <div className="page-option-list">
            <label className="page-option">
              <input type="radio" name="video" defaultChecked />
              <span className="page-option-label">
                <strong>Fast</strong> (Quick encoding)
              </span>
            </label>
            <label className="page-option">
              <input type="radio" name="video" />
              <span className="page-option-label">
                <strong>Balanced</strong> (Standard)
              </span>
            </label>
            <label className="page-option">
              <input type="radio" name="video" />
              <span className="page-option-label">
                <strong>Quality</strong> (Slower, better)
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="page-card">
        <p className="page-summary-label">Summary</p>
        <div className="page-summary">
          <p>
            📸 1,180 photos will be compressed with Balanced profile (est. 1,800 MB saved)
          </p>
          <p>
            🎬 162 videos will be compressed with Balanced preset (est. 1,040 MB saved)
          </p>
        </div>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button">
          ← Back
        </button>
        <button className="btn btn-primary" type="button">
          Continue to Grouping →
        </button>
      </div>
    </div>
  );
};
