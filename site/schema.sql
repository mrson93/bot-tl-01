CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY,title TEXT NOT NULL,price REAL NOT NULL,original_price REAL,discount REAL NOT NULL DEFAULT 0,rating REAL,sales INTEGER,shop TEXT,image_url TEXT NOT NULL,destination TEXT NOT NULL,source TEXT NOT NULL,category TEXT,published_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_offers_published ON offers(published_at DESC);
CREATE TABLE IF NOT EXISTS clicks (offer_id TEXT NOT NULL,clicked_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_site_clicks_time ON clicks(clicked_at);
