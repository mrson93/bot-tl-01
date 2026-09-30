CREATE TABLE IF NOT EXISTS editorial_metrics_daily (
  observed_on TEXT NOT NULL,
  post_slug TEXT NOT NULL,
  product_id TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT '',
  placement TEXT NOT NULL,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('view','click')),
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (observed_on,post_slug,product_id,store,placement,source,event_type)
);
CREATE INDEX IF NOT EXISTS idx_editorial_metrics_date ON editorial_metrics_daily(observed_on);
