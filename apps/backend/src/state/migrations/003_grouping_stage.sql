PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

ALTER TABLE item_stage_status RENAME TO item_stage_status_old;

CREATE TABLE item_stage_status (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('scan', 'classify', 'compress', 'group', 'organize')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES media_items(id) ON DELETE CASCADE,
  UNIQUE (session_id, item_id, stage)
);

INSERT INTO item_stage_status (
  id,
  session_id,
  item_id,
  stage,
  status,
  attempt_count,
  last_error,
  updated_at
)
SELECT
  id,
  session_id,
  item_id,
  stage,
  status,
  attempt_count,
  last_error,
  updated_at
FROM item_stage_status_old;

DROP TABLE item_stage_status_old;

ALTER TABLE session_checkpoints RENAME TO session_checkpoints_old;

CREATE TABLE session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('scan', 'classify', 'compress', 'group', 'organize')),
  cursor TEXT,
  payload_json TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, stage)
);

INSERT INTO session_checkpoints (
  id,
  session_id,
  stage,
  cursor,
  payload_json,
  updated_at
)
SELECT
  id,
  session_id,
  stage,
  cursor,
  payload_json,
  updated_at
FROM session_checkpoints_old;

DROP TABLE session_checkpoints_old;

CREATE INDEX IF NOT EXISTS idx_item_stage_status_session_stage ON item_stage_status(session_id, stage, status);
CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session_id ON session_checkpoints(session_id);

COMMIT;

PRAGMA foreign_keys = ON;
