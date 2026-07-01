BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS grouping_item_baselines (
  id TEXT PRIMARY KEY,
  grouping_session_id TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  initial_relative_path TEXT NOT NULL,
  initial_file_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (grouping_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES media_items(id) ON DELETE CASCADE,
  UNIQUE (grouping_session_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_grouping_item_baselines_grouping_session
  ON grouping_item_baselines(grouping_session_id);

COMMIT;
