export const CompressionPage = () => {
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 600, color: '#1a202c' }}>
          Optimize your media
        </h2>
        <p style={{ margin: 0, color: '#8896a8', fontSize: '14px' }}>
          Choose compression profiles for images and videos to reduce file size while maintaining quality.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {/* Image compression */}
        <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '20px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>📸 Image compression</h3>
          <p style={{ margin: '4px 0 12px', color: '#8896a8', fontSize: '12px' }}>mozjpeg profiles</p>

          <div style={{ display: 'grid', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="radio" name="image" defaultChecked style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: '#1a202c' }}>
                <strong>Balanced</strong> (80% quality)
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="radio" name="image" style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: '#1a202c' }}>
                <strong>High</strong> (90% quality)
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="radio" name="image" style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: '#1a202c' }}>
                <strong>Aggressive</strong> (70% quality)
              </span>
            </label>
          </div>
        </div>

        {/* Video compression */}
        <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '20px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>🎬 Video compression</h3>
          <p style={{ margin: '4px 0 12px', color: '#8896a8', fontSize: '12px' }}>HandBrake presets</p>

          <div style={{ display: 'grid', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="radio" name="video" defaultChecked style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: '#1a202c' }}>
                <strong>Fast</strong> (Quick encoding)
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="radio" name="video" style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: '#1a202c' }}>
                <strong>Balanced</strong> (Standard)
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="radio" name="video" style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: '12px', color: '#1a202c' }}>
                <strong>Quality</strong> (Slower, better)
              </span>
            </label>
          </div>
        </div>
      </div>

      <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '16px', marginBottom: '24px' }}>
        <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: '#1a202c' }}>Summary</p>
        <p style={{ margin: '0', fontSize: '12px', color: '#8896a8' }}>
          📸 1,180 photos will be compressed with Balanced profile (est. 1,800 MB saved)
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#8896a8' }}>
          🎬 162 videos will be compressed with Balanced preset (est. 1,040 MB saved)
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          style={{
            padding: '12px 20px',
            borderRadius: '10px',
            border: '1px solid #e8ecf2',
            background: '#ffffff',
            color: '#1a202c',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '13px'
          }}
        >
          ← Back
        </button>
        <button
          style={{
            padding: '12px 24px',
            borderRadius: '10px',
            border: 'none',
            background: '#2f8f65',
            color: '#ffffff',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '13px'
          }}
        >
          Continue to Grouping →
        </button>
      </div>
    </div>
  );
};
