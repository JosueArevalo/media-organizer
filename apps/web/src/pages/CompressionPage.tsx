import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type ImagePresetId = 'balanced' | 'high' | 'aggressive' | 'custom';

const IMAGE_PRESETS: Array<{ id: Exclude<ImagePresetId, 'custom'>; label: string; quality: number; note: string }> = [
  { id: 'balanced', label: 'Balanced', quality: 80, note: 'Great default for mixed galleries' },
  { id: 'high', label: 'High', quality: 90, note: 'Higher quality, lighter compression' },
  { id: 'aggressive', label: 'Aggressive', quality: 70, note: 'Smaller files with stronger compression' }
];

const clampQuality = (value: number) => {
  if (Number.isNaN(value)) {
    return 80;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
};

export const CompressionPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [imagePreset, setImagePreset] = useState<ImagePresetId>('balanced');
  const [customQuality, setCustomQuality] = useState<number>(72);

  const activePreset = IMAGE_PRESETS.find((preset) => preset.id === imagePreset);
  const effectiveImageQuality = imagePreset === 'custom' ? customQuality : (activePreset?.quality ?? 80);
  const selectedImageProfileLabel = imagePreset === 'custom' ? 'Custom' : (activePreset?.label ?? 'Balanced');
  const imageSavingsHint = useMemo(() => {
    if (effectiveImageQuality >= 90) {
      return 'est. 1,100 MB saved';
    }

    if (effectiveImageQuality >= 80) {
      return 'est. 1,800 MB saved';
    }

    return 'est. 2,400 MB saved';
  }, [effectiveImageQuality]);

  const handleBack = () => {
    const from = (location.state as { from?: string } | null)?.from;

    if (from && from !== location.pathname) {
      navigate(from);
      return;
    }

    navigate('/selection');
  };

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
          <p className="page-summary-note">mozjpeg quality (`cjpeg -quality`)</p>

          <div className="page-option-list">
            {IMAGE_PRESETS.map((preset) => (
              <label className="page-option" key={preset.id}>
                <input
                  type="radio"
                  name="image"
                  checked={imagePreset === preset.id}
                  onChange={() => setImagePreset(preset.id)}
                />
                <span className="page-option-label">
                  <strong>{preset.label}</strong> ({preset.quality}% quality) - {preset.note}
                </span>
              </label>
            ))}

            <label className="page-option">
              <input type="radio" name="image" checked={imagePreset === 'custom'} onChange={() => setImagePreset('custom')} />
              <span className="page-option-label">
                <strong>Custom</strong> (set your own quality)
              </span>
            </label>

            {imagePreset === 'custom' && (
              <label className="compression-custom-quality" htmlFor="image-quality-custom">
                <span className="page-option-label">
                  <strong>Custom quality</strong> (0-100)
                </span>
                <input
                  id="image-quality-custom"
                  className="compression-quality-input"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={customQuality}
                  onChange={(event) => setCustomQuality(clampQuality(Number(event.target.value)))}
                />
                <span className="page-summary-note">Example command: `cjpeg -quality {customQuality} -progressive -optimize ...`</span>
              </label>
            )}
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
            📸 1,180 photos will be compressed with {selectedImageProfileLabel} profile (quality {effectiveImageQuality}, {imageSavingsHint})
          </p>
          <p>
            🎬 162 videos will be compressed with Balanced preset (est. 1,040 MB saved)
          </p>
        </div>
      </div>

      <div className="page-footer-actions">
        <button className="btn btn-secondary" type="button" onClick={handleBack}>
          ← Back
        </button>
        <button className="btn btn-primary" type="button" onClick={() => navigate('/grouping', { state: { from: '/compression' } })}>
          Continue to Grouping →
        </button>
      </div>
    </div>
  );
};

export default CompressionPage;
