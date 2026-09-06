CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY,title TEXT NOT NULL,price REAL NOT NULL,original_price REAL,discount REAL NOT NULL DEFAULT 0,rating REAL,sales INTEGER,shop TEXT,image_url TEXT NOT NULL,destination TEXT NOT NULL,source TEXT NOT NULL,category TEXT,published_at INTEGER NOT NULL,coupon_code TEXT,coupon_condition TEXT,coupon_expires_at INTEGER,payment_label TEXT);
CREATE INDEX IF NOT EXISTS idx_offers_published ON offers(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_category_published ON offers(category,published_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_shop_published ON offers(shop,published_at DESC);
CREATE TABLE IF NOT EXISTS clicks (offer_id TEXT NOT NULL,clicked_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_site_clicks_time ON clicks(clicked_at);
CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY,source TEXT NOT NULL,code TEXT NOT NULL,title TEXT,kind TEXT NOT NULL DEFAULT 'code',condition TEXT,destination TEXT NOT NULL,active_at INTEGER,expires_at INTEGER,published_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_coupons_expires_published ON coupons(expires_at,published_at DESC);
