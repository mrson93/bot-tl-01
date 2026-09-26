CREATE TABLE IF NOT EXISTS blog_post_products (
  post_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  summary TEXT,
  image_url TEXT,
  affiliate_url TEXT NOT NULL,
  price_label TEXT,
  specs_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id,id),
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_blog_post_products_post
  ON blog_post_products(post_id,position);
