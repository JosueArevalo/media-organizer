import { useEffect, useState } from 'react';

type HealthResponse = {
  status: string;
  service: string;
  time: string;
  dbPath: string;
  appliedMigrations: string[];
};

export const App = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Backend responded with ${res.status}`);
        }
        return (await res.json()) as HealthResponse;
      })
      .then((data) => setHealth(data))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="page">
      <section className="panel">
        <h1>Media Organizer - Hello World</h1>
        <p>This dashboard is running and connected to the local backend.</p>

        {error && <p className="error">Backend error: {error}</p>}

        {!error && !health && <p>Checking backend health...</p>}

        {health && (
          <div className="status">
            <p>
              <strong>Service:</strong> {health.service}
            </p>
            <p>
              <strong>Status:</strong> {health.status}
            </p>
            <p>
              <strong>Time:</strong> {health.time}
            </p>
            <p>
              <strong>DB Path:</strong> {health.dbPath}
            </p>
            <p>
              <strong>Applied migrations:</strong> {health.appliedMigrations.length > 0 ? health.appliedMigrations.join(', ') : 'none in this run'}
            </p>
          </div>
        )}
      </section>
    </main>
  );
};
