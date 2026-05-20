import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatCard } from '../components/StatCard';
import { useTranslation } from '../i18n';
import {
  getBackendHealth,
  getDashboardStats,
  getRecentJobs,
  type BackendHealth,
  type DashboardStats,
  type RecentJob
} from '../services/dashboard.service';

export const DashboardPage = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [jobs, setJobs] = useState<RecentJob[]>([]);
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardStats().then(setStats);
    getRecentJobs().then(setJobs);

    getBackendHealth()
      .then((data) => {
        setHealth(data);
        setHealthError(null);
      })
      .catch((err: Error) => setHealthError(err.message));
  }, []);

  return (
    <div className="dashboard-grid">
      <section className="panel panel-highlight">
        <p className="panel-kicker">{t('dashboard.status')}</p>
        <h2 className="panel-title">{t('dashboard.welcome')}</h2>
        <p className="panel-description">{t('dashboard.description')}</p>
        <div className="action-row">
          <Link to="/import" className="btn btn-primary">
            🚀 {t('dashboard.startWorkflow')}
          </Link>
        </div>
      </section>

      <section className="stats-grid" aria-label={t('dashboard.stats.aria')}>
        <StatCard
          title={t('dashboard.stats.mediaScanned')}
          value={stats ? `${stats.totalItems}` : '...'}
          hint={t('dashboard.stats.mediaScannedHint')}
        />
        <StatCard
          title={t('dashboard.stats.photos')}
          value={stats ? `${stats.photos}` : '...'}
          hint={t('dashboard.stats.photosHint')}
        />
        <StatCard
          title={t('dashboard.stats.videos')}
          value={stats ? `${stats.videos}` : '...'}
          hint={t('dashboard.stats.videosHint')}
        />
        <StatCard
          title={t('dashboard.stats.savings')}
          value={stats ? `${stats.estimatedSavingsMb} MB` : '...'}
          hint={t('dashboard.stats.savingsHint')}
        />
      </section>

      <section className="panel">
        <div className="panel-row">
          <div>
            <p className="panel-kicker">{t('dashboard.recentJobs')}</p>
            <h3 className="panel-title small">{t('dashboard.resumePoints')}</h3>
          </div>
        </div>

        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-item">
              <div>
                <p className="job-title">{job.label}</p>
                <p className="job-meta">{job.stage}</p>
              </div>
              <div className="job-right">
                <p className="job-meta">{job.updatedAt}</p>
                <div className="progress-bar" aria-label={t('dashboard.progressLabel', { progress: job.progress })}>
                  <span style={{ width: `${job.progress}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <p className="panel-kicker">{t('dashboard.backendSignal')}</p>
        <h3 className="panel-title small">{t('dashboard.healthProbe')}</h3>

        {healthError && <p className="error">{t('dashboard.backendError', { message: healthError })}</p>}

        {!health && !healthError && <p className="muted">{t('dashboard.checkingHealth')}</p>}

        {health && (
          <div className="health-grid">
            <p>
              <strong>{t('dashboard.service')}</strong>
              <br />
              {health.service}
            </p>
            <p>
              <strong>{t('dashboard.healthStatus')}</strong>
              <br />
              {health.status}
            </p>
            <p>
              <strong>{t('dashboard.time')}</strong>
              <br />
              {health.time}
            </p>
            <p>
              <strong>{t('dashboard.migrations')}</strong>
              <br />
              {health.appliedMigrations.length > 0 ? health.appliedMigrations.join(', ') : t('dashboard.noMigrations')}
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default DashboardPage;
