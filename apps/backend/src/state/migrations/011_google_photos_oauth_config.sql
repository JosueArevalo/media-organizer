BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS google_photos_oauth_config (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  client_id TEXT NOT NULL,
  client_secret TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

COMMIT;
