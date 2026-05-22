BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS network_destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  username TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (root_path)
);

CREATE INDEX IF NOT EXISTS idx_network_destinations_updated_at ON network_destinations(updated_at);

COMMIT;
