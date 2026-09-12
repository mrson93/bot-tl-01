CREATE TABLE IF NOT EXISTS instagram_story_offers (
  media_id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  offer_id TEXT,
  title TEXT NOT NULL,
  price REAL,
  link TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_instagram_story_offers_time
  ON instagram_story_offers(published_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instagram_story_offers_container
  ON instagram_story_offers(container_id);

CREATE TABLE IF NOT EXISTS instagram_dm_events (
  event_hash TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_instagram_dm_events_time
  ON instagram_dm_events(created_at);
