-- Cliques nos blocos da página inicial (layout de nov/2026), por dia e bloco.
-- Só contagens: nenhum dado de quem clicou.
CREATE TABLE IF NOT EXISTS home_clicks_daily (
  observed_on TEXT NOT NULL,
  block TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (observed_on, block)
);
