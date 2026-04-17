import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

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
        <h1 style="margin: 0 0 8px; font-size: 20px;">UI bootstrap failed</h1>
        <p style="margin: 0 0 14px; color: #94a3b8; line-height: 1.5;">
          The application could not render correctly. Please refresh the page and check the browser console for details.
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

const bootstrap = async () => {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    return;
  }

  try {
    const { App } = await import('./App');

    createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error('Application bootstrap error:', error);
    renderBootstrapError(error);
  }
};

void bootstrap();
