BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  source_dir TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'draft',
    'scanned',
    'ready',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'unknown')),
  source_kind_detected TEXT NOT NULL CHECK (source_kind_detected IN ('camera', 'whatsapp', 'screenshot', 'unknown')),
  source_kind_override TEXT CHECK (source_kind_override IN ('camera', 'whatsapp', 'screenshot', 'unknown')),
  size_bytes INTEGER NOT NULL,
  capture_time TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, source_path)
);

CREATE TABLE IF NOT EXISTS item_decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  selected_for_compression INTEGER NOT NULL DEFAULT 0 CHECK (selected_for_compression IN (0, 1)),
  selected_for_output INTEGER NOT NULL DEFAULT 1 CHECK (selected_for_output IN (0, 1)),
  target_group_label TEXT,
  user_overridden INTEGER NOT NULL DEFAULT 0 CHECK (user_overridden IN (0, 1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES media_items(id) ON DELETE CASCADE,
  UNIQUE (session_id, item_id)
);

CREATE TABLE IF NOT EXISTS item_stage_status (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('scan', 'classify', 'compress', 'organize')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES media_items(id) ON DELETE CASCADE,
  UNIQUE (session_id, item_id, stage)
);

CREATE TABLE IF NOT EXISTS session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('scan', 'classify', 'compress', 'organize')),
  cursor TEXT,
  payload_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_media_items_session_id ON media_items(session_id);
CREATE INDEX IF NOT EXISTS idx_media_items_kind ON media_items(source_kind_detected);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_item_stage_status_session_stage ON item_stage_status(session_id, stage, status);
CREATE INDEX IF NOT EXISTS idx_item_decisions_session_id ON item_decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session_id ON session_checkpoints(session_id);

COMMIT;
