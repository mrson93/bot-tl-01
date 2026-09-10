CREATE TABLE IF NOT EXISTS page_views_daily (
  observed_on TEXT NOT NULL,
  path TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (observed_on,path)
);
CREATE INDEX IF NOT EXISTS idx_page_views_daily_date ON page_views_daily(observed_on);
PRAGMA optimize;
