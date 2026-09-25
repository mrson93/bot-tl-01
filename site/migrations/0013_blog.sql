CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  cover_image_url TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  meta_title TEXT,
  meta_description TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published
  ON blog_posts(status,published_at DESC);

CREATE TABLE IF NOT EXISTS blog_post_offers (
  post_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id,offer_id),
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_blog_post_offers_post
  ON blog_post_offers(post_id,position);
