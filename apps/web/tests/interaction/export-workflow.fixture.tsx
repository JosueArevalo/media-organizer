import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../src/i18n';
import { GooglePhotosExportPage } from '../../src/pages/GooglePhotosExportPage';
import { NetworkFolderExportPage } from '../../src/pages/NetworkFolderExportPage';
import '../../src/styles.css';
import { startGroupingSession } from '../../src/services/grouping-job.store';

createRoot(document.getElementById('root')!).render(
  <MemoryRouter><I18nProvider>
    {new URLSearchParams(window.location.search).get('provider') === 'network-folder'
      ? <NetworkFolderExportPage /> : <GooglePhotosExportPage />}
    <button type="button" onClick={() => startGroupingSession({ backendSessionId: 'grouping-2', outputRootLabel: 'C:/other-source' })}>
      Change source context
    </button>
  </I18nProvider></MemoryRouter>
);
