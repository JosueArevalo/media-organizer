import { Link } from 'react-router-dom';
import { ExportProviderIcon } from '../components/ExportProviderIcon';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import { exportProviders, type ExportProviderStatus } from '../services/export-providers';

const providerStatusLabels: Record<ExportProviderStatus, 'export.status.available' | 'export.status.spike' | 'export.status.planned'> = {
  available: 'export.status.available',
  spike: 'export.status.spike',
  planned: 'export.status.planned'
};

export const ExportPage = () => {
  const { t } = useTranslation();
  const groupingSessionState = useGroupingSessionState();
  const sourceRoot = groupingSessionState.outputRootLabel ?? '';

  return (
    <div className="page-stack export-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">{t('export.hub.title')}</h2>
          <p className="page-subtitle">{t('export.hub.subtitle')}</p>
        </div>
      </div>

      {!sourceRoot && <p className="error">{t('export.unavailable')}</p>}

      <section className="settings-panel export-source-panel">
        <p className="page-section-title">{t('export.sourceTitle')}</p>
        <p className="page-summary-note">{sourceRoot || t('export.noSource')}</p>
      </section>

      <section className="export-provider-grid" aria-label={t('export.hub.providersAria')}>
        {exportProviders.map((provider) => (
          <Link key={provider.id} to={provider.route} className={`export-provider-card export-provider-card-${provider.status}`}>
            <ExportProviderIcon visual={provider.visual} />
            <div className="export-provider-card-copy">
              <span className={`status-pill export-provider-status export-provider-status-${provider.status}`}>
                {t(providerStatusLabels[provider.status])}
              </span>
              <h3>{t(provider.titleKey)}</h3>
              <p>{t(provider.subtitleKey)}</p>
            </div>
            <span className="export-provider-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
};

export default ExportPage;
