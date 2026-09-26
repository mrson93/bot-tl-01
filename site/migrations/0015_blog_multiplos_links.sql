CREATE TABLE IF NOT EXISTS blog_product_links (
  post_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  id TEXT NOT NULL,
  store TEXT NOT NULL,
  label TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id,product_id,id),
  FOREIGN KEY (post_id,product_id) REFERENCES blog_post_products(post_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_blog_product_links_product
  ON blog_product_links(post_id,product_id,position);
