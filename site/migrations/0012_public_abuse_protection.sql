CREATE TABLE IF NOT EXISTS abuse_events (
  event_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_events_expires ON abuse_events(expires_at);
PRAGMA optimize;
