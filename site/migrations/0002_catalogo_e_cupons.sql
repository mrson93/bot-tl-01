ALTER TABLE offers ADD COLUMN coupon_code TEXT;
ALTER TABLE offers ADD COLUMN coupon_condition TEXT;
ALTER TABLE offers ADD COLUMN coupon_expires_at INTEGER;
ALTER TABLE offers ADD COLUMN payment_label TEXT;
CREATE INDEX IF NOT EXISTS idx_offers_category_published ON offers(category,published_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_shop_published ON offers(shop,published_at DESC);
CREATE TABLE IF NOT EXISTS coupons (id TEXT PRIMARY KEY,source TEXT NOT NULL,code TEXT NOT NULL,condition TEXT,destination TEXT NOT NULL,active_at INTEGER,expires_at INTEGER,published_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_coupons_expires_published ON coupons(expires_at,published_at DESC);
PRAGMA optimize;
