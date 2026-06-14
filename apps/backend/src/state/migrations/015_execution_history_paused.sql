PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

ALTER TABLE execution_history RENAME TO execution_history_old;

CREATE TABLE execution_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  grouping_session_id TEXT,
  name TEXT,
  source_dir TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  output_root TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
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
  grouping_status TEXT CHECK (grouping_status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  grouping_total_items INTEGER NOT NULL DEFAULT 0,
  grouping_completed_items INTEGER NOT NULL DEFAULT 0,
  grouping_failed_items INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  verification_json TEXT,
  original_bytes INTEGER,
  final_bytes INTEGER,
  image_quality INTEGER,
  compression_active_duration_ms INTEGER,
  compression_active_started_at TEXT
);

INSERT INTO execution_history (
  id,
  session_id,
  grouping_session_id,
  name,
  source_dir,
  output_dir,
  output_root,
  status,
  started_at,
  finished_at,
  updated_at,
  total_items,
  image_items,
  video_items,
  completed_items,
  failed_items,
  image_profile_label,
  video_preset_label,
  error_summary_json,
  grouping_status,
  grouping_total_items,
  grouping_completed_items,
  grouping_failed_items,
  created_at,
  verification_json,
  original_bytes,
  final_bytes,
  image_quality,
  compression_active_duration_ms,
  compression_active_started_at
)
SELECT
  id,
  session_id,
  grouping_session_id,
  name,
  source_dir,
  output_dir,
  output_root,
  CASE WHEN status = 'running' THEN 'paused' ELSE status END,
  started_at,
  finished_at,
  updated_at,
  total_items,
  image_items,
  video_items,
  completed_items,
  failed_items,
  image_profile_label,
  video_preset_label,
  error_summary_json,
  CASE WHEN grouping_status = 'running' THEN 'paused' ELSE grouping_status END,
  grouping_total_items,
  grouping_completed_items,
  grouping_failed_items,
  created_at,
  verification_json,
  original_bytes,
  final_bytes,
  image_quality,
  compression_active_duration_ms,
  CASE WHEN status = 'running' THEN NULL ELSE compression_active_started_at END
FROM execution_history_old;

DROP TABLE execution_history_old;

CREATE INDEX IF NOT EXISTS idx_execution_history_updated_at ON execution_history(updated_at);
CREATE INDEX IF NOT EXISTS idx_execution_history_status ON execution_history(status);
CREATE INDEX IF NOT EXISTS idx_execution_history_grouping_session_id ON execution_history(grouping_session_id);

COMMIT;

PRAGMA foreign_keys = ON;
