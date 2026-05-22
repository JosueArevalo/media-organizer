import { useNavigate } from 'react-router-dom';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';

export const GoogleDriveExportPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groupingSessionState = useGroupingSessionState();
  const sourceRoot = groupingSessionState.outputRootLabel ?? '';

  return (
    <div className="page-stack export-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">{t('export.googleDrive.title')}</h2>
          <p className="page-subtitle">{t('export.googleDrive.subtitle')}</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => navigate('/export')}>
          {t('export.backToProviders')}
        </button>
      </div>

      {!sourceRoot && <p className="error">{t('export.unavailable')}</p>}

      <section className="settings-panel export-spike-panel">
        <div className="export-spike-visual export-provider-visual export-provider-visual-drive" aria-hidden="true">
          <span className="export-provider-shape export-provider-shape-primary" />
          <span className="export-provider-shape export-provider-shape-secondary" />
          <span className="export-provider-shape export-provider-shape-tertiary" />
        </div>
        <div>
          <p className="page-section-title">{t('export.sourceTitle')}</p>
          <p className="page-summary-note">{sourceRoot || t('export.noSource')}</p>
        </div>
        <p className="page-summary-note">{t('export.googleDrive.note')}</p>
        <button className="btn btn-secondary" type="button" disabled>
          {t('export.googleDrive.disabledAction')}
        </button>
      </section>

      <section className="settings-panel export-panel">
        <p className="page-section-title">{t('export.googleDrive.nextTitle')}</p>
        <ul className="export-spike-list">
          <li>{t('export.googleDrive.stepOauth')}</li>
          <li>{t('export.googleDrive.stepFolders')}</li>
          <li>{t('export.googleDrive.stepUpload')}</li>
          <li>{t('export.googleDrive.stepResume')}</li>
        </ul>
      </section>
    </div>
  );
};

export default GoogleDriveExportPage;
