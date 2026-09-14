CREATE TABLE IF NOT EXISTS instagram_story_clicks_daily (
  observed_on TEXT NOT NULL,
  media_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (observed_on, media_id, offer_id)
);
CREATE INDEX IF NOT EXISTS idx_instagram_story_clicks_date
  ON instagram_story_clicks_daily(observed_on);
PRAGMA optimize;
