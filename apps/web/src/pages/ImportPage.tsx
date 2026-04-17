export const ImportPage = () => {
  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: 600, color: '#1a202c' }}>
          Select your folders
        </h2>
        <p style={{ margin: 0, color: '#8896a8', fontSize: '14px', lineHeight: 1.6 }}>
          Choose where your media files are stored and where you'd like the organized output to go.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '20px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '10px',
              background: '#f0f8f4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
              fontSize: '24px'
            }}
          >
            📁
          </div>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>Source folder</h3>
          <p style={{ margin: '0 0 12px', color: '#8896a8', fontSize: '12px' }}>Where your photos and videos are</p>
          <button
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #e8ecf2',
              background: '#ffffff',
              color: '#1a202c',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#2f8f65';
              e.currentTarget.style.background = '#f0f8f4';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e8ecf2';
              e.currentTarget.style.background = '#ffffff';
            }}
          >
            Choose folder
          </button>
        </div>

        <div style={{ borderRadius: '12px', border: '1px solid #e8ecf2', background: '#f7f9fb', padding: '20px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '10px',
              background: '#f0f8f4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
              fontSize: '24px'
            }}
          >
            📂
          </div>
          <h3 style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: '#1a202c' }}>Destination folder</h3>
          <p style={{ margin: '0 0 12px', color: '#8896a8', fontSize: '12px' }}>Where to save organized files</p>
          <button
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #e8ecf2',
              background: '#ffffff',
              color: '#1a202c',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '13px',
              transition: 'all 150ms ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#2f8f65';
              e.currentTarget.style.background = '#f0f8f4';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e8ecf2';
              e.currentTarget.style.background = '#ffffff';
            }}
          >
            Choose folder
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '40px' }}>
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
          Continue to Preview →
        </button>
      </div>
    </div>
  );
};
