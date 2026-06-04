import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportProviderIcon } from '../components/ExportProviderIcon';
import { useGroupingSessionState } from '../hooks/useGroupingJobState';
import { useTranslation } from '../i18n';
import { exportProviders, type ExportProviderStatus } from '../services/export-providers';
import {
  getExportProviderSummariesRequest,
  type ExportCoverageStatus,
  type ExportProviderSummary
} from '../services/export.service';

const providerStatusLabels: Record<ExportProviderStatus, 'export.status.available' | 'export.status.spike' | 'export.status.planned'> = {
  available: 'export.status.available',
  spike: 'export.status.spike',
  planned: 'export.status.planned'
};

const coverageStatusLabels: Record<ExportCoverageStatus, 'export.coverage.notStarted' | 'export.coverage.partial' | 'export.coverage.completed'> = {
  not_started: 'export.coverage.notStarted',
  partial: 'export.coverage.partial',
  completed: 'export.coverage.completed'
};

export const ExportPage = () => {
  const { t } = useTranslation();
  const groupingSessionState = useGroupingSessionState();
  const sourceRoot = groupingSessionState.outputRootLabel ?? '';
  const [summaries, setSummaries] = useState<ExportProviderSummary[]>([]);

  useEffect(() => {
    if (!groupingSessionState.backendSessionId && !sourceRoot) {
      setSummaries([]);
      return;
    }

    void getExportProviderSummariesRequest({
      groupingSessionId: groupingSessionState.backendSessionId,
      sourceRoot
    })
      .then(setSummaries)
      .catch(() => setSummaries([]));
  }, [groupingSessionState.backendSessionId, sourceRoot]);

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
        {exportProviders.map((provider) => {
          const summary = summaries.find((item) => item.provider === provider.targetType);
          const coverage = summary?.coverageStatus ?? 'not_started';

          return (
            <Link
              key={provider.id}
              to={provider.route}
              className={`export-provider-card export-provider-card-${provider.status} export-provider-card-${coverage}`}
            >
              <ExportProviderIcon visual={provider.visual} />
              <div className="export-provider-card-copy">
                <span className={`status-pill export-provider-status export-provider-status-${provider.status} export-provider-status-${coverage}`}>
                  {provider.status === 'available' ? t(coverageStatusLabels[coverage]) : t(providerStatusLabels[provider.status])}
                </span>
                <h3>{t(provider.titleKey)}</h3>
                <p>{t(provider.subtitleKey)}</p>
                {provider.status === 'available' && summary && (
                  <p className="export-provider-coverage">
                    {t('export.coverage.items', { covered: summary.coveredItems, eligible: summary.eligibleItems })}
                    {summary.eligibleAlbums !== null
                      ? ` · ${t('export.coverage.albums', { covered: summary.coveredAlbums ?? 0, eligible: summary.eligibleAlbums })}`
                      : ` · ${t('export.coverage.completedJobs', { count: summary.completedJobs })}`}
                  </p>
                )}
              </div>
              {coverage === 'completed' && <span className="export-provider-check" aria-label={t('export.coverage.completed')}>✓</span>}
              <span className="export-provider-arrow" aria-hidden="true">&rarr;</span>
            </Link>
          );
        })}
      </section>
    </div>
  );
};

export default ExportPage;
