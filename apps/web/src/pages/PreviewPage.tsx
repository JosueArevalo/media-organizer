export const PreviewPage = () => {
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 600, color: '#1a202c' }}>
          Review and select items
        </h2>
        <p style={{ margin: 0, color: '#8896a8', fontSize: '14px' }}>
          Here you can preview detected media, apply bulk selections, and adjust classifications before processing.
        </p>
      </div>

      <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '20px', marginBottom: '24px' }}>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
            <input type="checkbox" style={{ cursor: 'pointer' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a202c' }}>Select all items</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
            <input type="checkbox" style={{ cursor: 'pointer' }} />
            <span style={{ fontSize: '13px', color: '#8896a8' }}>Select only large files (&gt;5MB)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" style={{ cursor: 'pointer' }} />
            <span style={{ fontSize: '13px', color: '#8896a8' }}>Exclude WhatsApp/Screenshots</span>
          </label>
        </div>
      </div>

      <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#ffffff', padding: '16px', marginBottom: '24px' }}>
        <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: '#1a202c' }}>Detected items (mock data)</p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
          {[
            { type: 'Photo', source: 'Camera', size: '3.2 MB', selected: true },
            { type: 'Photo', source: 'Screenshot', size: '1.1 MB', selected: false },
            { type: 'Video', source: 'Camera', size: '125.4 MB', selected: true }
          ].map((item, i) => (
            <li
              key={i}
              style={{
                padding: '10px',
                borderRadius: '8px',
                background: item.selected ? '#f0f8f4' : '#f7f9fb',
                border: `1px solid ${item.selected ? '#d5e4db' : '#e8ecf2'}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12px'
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input type="checkbox" defaultChecked={item.selected} style={{ cursor: 'pointer' }} />
                <span style={{ fontWeight: 600, color: '#1a202c' }}>{item.type}</span>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: '#e8ecf2',
                    color: '#5f7580'
                  }}
                >
                  {item.source}
                </span>
              </div>
              <span style={{ color: '#8896a8' }}>{item.size}</span>
            </li>
          ))}
        </ul>
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
          Continue to Compression →
        </button>
      </div>
    </div>
  );
};
