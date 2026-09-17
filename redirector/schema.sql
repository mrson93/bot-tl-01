CREATE TABLE IF NOT EXISTS links (
  slug TEXT PRIMARY KEY,
  destination TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clicks (
  slug TEXT NOT NULL,
  clicked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clicks_time ON clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_clicks_slug ON clicks(slug);

CREATE TABLE IF NOT EXISTS abuse_events (
  event_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_events_expires ON abuse_events(expires_at);
