import React from 'react';
import { createRoot } from 'react-dom/client';
import { en } from './i18n/locales/en';
import './styles.css';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppRuntimeErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: ''
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  componentDidCatch(error: unknown) {
    console.error('Runtime render error:', error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#0f1319',
          color: '#edf2f7',
          fontFamily: "'Segoe UI', sans-serif"
        }}
      >
        <div
          style={{
            maxWidth: '720px',
            width: '100%',
            border: '1px solid #2b3442',
            borderRadius: '12px',
            background: '#171d26',
            padding: '20px'
          }}
        >
          <h1 style={{ margin: '0 0 8px', fontSize: '20px' }}>{en['app.error.runtimeTitle']}</h1>
          <p style={{ margin: '0 0 14px', color: '#94a3b8', lineHeight: 1.5 }}>
            {en['app.error.runtimeBody']}
          </p>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: '1px solid #2b3442',
              borderRadius: '8px',
              background: '#0f1319',
              padding: '12px',
              color: '#fca5a5',
              fontSize: '12px'
            }}
          >
            {this.state.message}
          </pre>
        </div>
      </section>
    );
  }
}

const renderBootstrapError = (error: unknown) => {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);

  rootElement.innerHTML = `
    <section style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #0f1319;
      color: #edf2f7;
      font-family: 'Segoe UI', sans-serif;
    ">
      <div style="
        max-width: 720px;
        width: 100%;
        border: 1px solid #2b3442;
        border-radius: 12px;
        background: #171d26;
        padding: 20px;
      ">
        <h1 style="margin: 0 0 8px; font-size: 20px;">${en['app.error.bootstrapTitle']}</h1>
        <p style="margin: 0 0 14px; color: #94a3b8; line-height: 1.5;">
          ${en['app.error.bootstrapBody']}
        </p>
        <pre style="
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          border: 1px solid #2b3442;
          border-radius: 8px;
          background: #0f1319;
          padding: 12px;
          color: #fca5a5;
          font-size: 12px;
        ">${message}</pre>
      </div>
    </section>
  `;
};

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('Global runtime error:', event.error ?? event.message);
    renderBootstrapError(event.error ?? event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    renderBootstrapError(event.reason);
  });
}

const bootstrap = async () => {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    return;
  }

  try {
    const appEntryModule = await import('./app-entry');
    const AppComponent = appEntryModule.default;

    if (typeof AppComponent !== 'function') {
      throw new Error('App entry default export is not a valid React component.');
    }

    createRoot(rootElement).render(
      <AppRuntimeErrorBoundary>
        <React.StrictMode>
          <AppComponent />
        </React.StrictMode>
      </AppRuntimeErrorBoundary>
    );
  } catch (error) {
    console.error('Application bootstrap error:', error);
    renderBootstrapError(error);
  }
};

void bootstrap();
