-- Índices para as páginas públicas lerem só as linhas que mostram, em vez de
-- percorrer a tabela de ofertas inteira (estourava a cota diária do D1).
CREATE INDEX IF NOT EXISTS idx_clicks_offer_time ON clicks(offer_id,clicked_at);
CREATE INDEX IF NOT EXISTS idx_offers_category_discount ON offers(category,discount DESC);
CREATE INDEX IF NOT EXISTS idx_offers_category_checked ON offers(category,COALESCE(last_checked_at,published_at) DESC);
CREATE INDEX IF NOT EXISTS idx_offers_shop_checked ON offers(shop,COALESCE(last_checked_at,published_at) DESC);
