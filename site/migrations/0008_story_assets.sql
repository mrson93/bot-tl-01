CREATE TABLE IF NOT EXISTS story_assets (
  id TEXT PRIMARY KEY,
  image BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_story_assets_expires ON story_assets(expires_at);
PRAGMA optimize;
