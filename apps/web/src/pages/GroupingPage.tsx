export const GroupingPage = () => {
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 600, color: '#1a202c' }}>
          Structure your output
        </h2>
        <p style={{ margin: 0, color: '#8896a8', fontSize: '14px' }}>
          Review and customize how your media will be organized into folders. Edit names and groupings as needed.
        </p>
      </div>

      <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '16px', marginBottom: '24px' }}>
        <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: '#1a202c' }}>Proposed folder structure (mock)</p>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '8px' }}>
          {[
            { name: '2026.04 - Spring Cleanup', items: 342 },
            { name: '2026.03 - Family Event', items: 156 },
            { name: '2026.02 - Vacation', items: 284 },
            { name: '2026.01 - Misc', items: 560 }
          ].map((folder, i) => (
            <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  background: '#ffffff',
                  border: '1px solid #e8ecf2',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}
              >
                <span style={{ fontSize: '14px' }}>📁</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0', fontSize: '13px', fontWeight: 600, color: '#1a202c' }}>{folder.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#8896a8' }}>{folder.items} files</p>
                </div>
              </div>
              <button
                style={{
                  marginLeft: '8px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid #e8ecf2',
                  background: '#ffffff',
                  color: '#5f7580',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '16px', marginBottom: '24px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input type="checkbox" defaultChecked style={{ cursor: 'pointer' }} />
          <span style={{ fontSize: '12px', color: '#1a202c', fontWeight: 600 }}>
            Auto-rename folders with consistent naming pattern
          </span>
        </label>
        <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#8896a8' }}>
          Uses pattern: YYYY.MM - Event Name
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
          Apply and Start Processing
        </button>
      </div>
    </div>
  );
};
