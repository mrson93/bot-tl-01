CREATE TABLE IF NOT EXISTS traffic_sources_daily (
  observed_on TEXT NOT NULL,
  source TEXT NOT NULL,
  landing_path TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (observed_on,source,landing_path)
);
CREATE INDEX IF NOT EXISTS idx_traffic_sources_daily_date ON traffic_sources_daily(observed_on);
PRAGMA optimize;
