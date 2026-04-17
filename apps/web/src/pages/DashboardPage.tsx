import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatCard } from '../components/StatCard';
import {
  getBackendHealth,
  getDashboardStats,
  getRecentJobs,
  type BackendHealth,
  type DashboardStats,
  type RecentJob
} from '../services/dashboard.service';

export const DashboardPage = () => {
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
        <p className="panel-kicker">Status</p>
        <h2 className="panel-title">Welcome back</h2>
        <p className="panel-description">
          Here's an overview of your media organization system. You can start a new workflow, resume a previous job, or check the status of running processes.
        </p>
        <div className="action-row">
          <Link to="/import" className="btn btn-primary">
            🚀 Start new workflow
          </Link>
          <Link to="/jobs" className="btn btn-secondary">
            📋 View all jobs
          </Link>
        </div>
      </section>

      <section className="stats-grid" aria-label="Mocked stats">
        <StatCard
          title="Media scanned"
          value={stats ? `${stats.totalItems}` : '...'}
          hint="Mock source from dashboard service"
        />
        <StatCard
          title="Photos"
          value={stats ? `${stats.photos}` : '...'}
          hint="Includes camera + screenshots"
        />
        <StatCard
          title="Videos"
          value={stats ? `${stats.videos}` : '...'}
          hint="Candidate items for HandBrake"
        />
        <StatCard
          title="Estimated savings"
          value={stats ? `${stats.estimatedSavingsMb} MB` : '...'}
          hint="Potential compression win"
        />
      </section>

      <section className="panel">
        <div className="panel-row">
          <div>
            <p className="panel-kicker">Recent jobs</p>
            <h3 className="panel-title small">Resume points (mocked)</h3>
          </div>
          <Link to="/jobs" className="btn btn-ghost">
            Open all jobs
          </Link>
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
                <div className="progress-bar" aria-label={`Progress ${job.progress}%`}>
                  <span style={{ width: `${job.progress}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <p className="panel-kicker">Live backend signal</p>
        <h3 className="panel-title small">Health probe</h3>

        {healthError && <p className="error">Backend error: {healthError}</p>}

        {!health && !healthError && <p className="muted">Checking backend health...</p>}

        {health && (
          <div className="health-grid">
            <p>
              <strong>Service</strong>
              <br />
              {health.service}
            </p>
            <p>
              <strong>Status</strong>
              <br />
              {health.status}
            </p>
            <p>
              <strong>Time</strong>
              <br />
              {health.time}
            </p>
            <p>
              <strong>Migrations</strong>
              <br />
              {health.appliedMigrations.length > 0 ? health.appliedMigrations.join(', ') : 'none in this run'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default DashboardPage;
