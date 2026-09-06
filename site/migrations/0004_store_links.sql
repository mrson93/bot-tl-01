CREATE TABLE IF NOT EXISTS store_links (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  destination TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
PRAGMA optimize;
