BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS google_photos_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_connected_at TEXT NOT NULL,
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS google_photos_oauth_sessions (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_photos_albums (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  google_album_id TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  product_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES google_photos_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, google_album_id),
  UNIQUE (account_id, normalized_title)
);

CREATE TABLE IF NOT EXISTS export_google_photos_items (
  item_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  local_album_title TEXT NOT NULL,
  google_album_id TEXT,
  upload_token TEXT,
  upload_token_created_at TEXT,
  media_item_id TEXT,
  product_url TEXT,
  phase TEXT NOT NULL CHECK (phase IN ('planned', 'uploaded', 'created')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES export_items(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES google_photos_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_google_photos_albums_account_title ON google_photos_albums(account_id, normalized_title);
CREATE INDEX IF NOT EXISTS idx_export_google_photos_items_account ON export_google_photos_items(account_id);

COMMIT;
