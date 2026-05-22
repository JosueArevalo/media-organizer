BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  name TEXT,
  source_root TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('network-folder', 'google-photos')),
  target_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS export_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES export_jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id, source_path)
);

CREATE TABLE IF NOT EXISTS export_checkpoints (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  cursor TEXT,
  payload_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES export_jobs(id) ON DELETE CASCADE,
  UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
CREATE INDEX IF NOT EXISTS idx_export_items_job_status ON export_items(job_id, status);
CREATE INDEX IF NOT EXISTS idx_export_checkpoints_job_id ON export_checkpoints(job_id);

COMMIT;
