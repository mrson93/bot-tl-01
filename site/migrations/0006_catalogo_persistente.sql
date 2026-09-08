ALTER TABLE offers ADD COLUMN cataloged_at INTEGER;
ALTER TABLE offers ADD COLUMN last_checked_at INTEGER;
ALTER TABLE offers ADD COLUMN last_seen_at INTEGER;
ALTER TABLE offers ADD COLUMN availability TEXT NOT NULL DEFAULT 'active';
ALTER TABLE offers ADD COLUMN refresh_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offers ADD COLUMN price_changed_at INTEGER;

UPDATE offers SET
  cataloged_at=COALESCE(cataloged_at,published_at),
  last_checked_at=COALESCE(last_checked_at,published_at),
  last_seen_at=COALESCE(last_seen_at,published_at),
  price_changed_at=COALESCE(price_changed_at,published_at),
  availability='active',
  refresh_failures=0;

CREATE INDEX IF NOT EXISTS idx_offers_availability_checked
  ON offers(availability,last_checked_at);
CREATE INDEX IF NOT EXISTS idx_offers_cataloged
  ON offers(cataloged_at DESC);
PRAGMA optimize;
