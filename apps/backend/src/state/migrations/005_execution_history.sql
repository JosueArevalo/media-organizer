BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS execution_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  grouping_session_id TEXT,
  name TEXT,
  source_dir TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  output_root TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  image_items INTEGER NOT NULL DEFAULT 0,
  video_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  image_profile_label TEXT,
  video_preset_label TEXT,
  error_summary_json TEXT,
  grouping_status TEXT CHECK (grouping_status IN ('running', 'completed', 'failed', 'cancelled')),
  grouping_total_items INTEGER NOT NULL DEFAULT 0,
  grouping_completed_items INTEGER NOT NULL DEFAULT 0,
  grouping_failed_items INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_history_updated_at ON execution_history(updated_at);
CREATE INDEX IF NOT EXISTS idx_execution_history_status ON execution_history(status);
CREATE INDEX IF NOT EXISTS idx_execution_history_grouping_session_id ON execution_history(grouping_session_id);

COMMIT;
