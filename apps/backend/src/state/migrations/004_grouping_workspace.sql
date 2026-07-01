BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS grouping_folders (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('proposed', 'manual', 'template')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, label)
);

CREATE TABLE IF NOT EXISTS grouping_folder_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_grouping_folders_session_id ON grouping_folders(session_id);
CREATE INDEX IF NOT EXISTS idx_grouping_folder_templates_enabled ON grouping_folder_templates(enabled);

COMMIT;
