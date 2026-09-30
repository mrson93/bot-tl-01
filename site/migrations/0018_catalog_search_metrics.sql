CREATE TABLE IF NOT EXISTS catalog_search_daily(observed_on TEXT NOT NULL,source TEXT NOT NULL,device TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('results','empty')),quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(observed_on,source,device,outcome));
CREATE INDEX IF NOT EXISTS idx_catalog_search_date ON catalog_search_daily(observed_on);
