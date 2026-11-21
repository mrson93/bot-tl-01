-- Link rastreado do botão "Ver na loja" do cartão e do mini app (canal
-- alerta_cartao no redirecionador) e cliques diários do bot de alertas,
-- copiados do redirecionador pela coleta para o painel /estatisticas.
ALTER TABLE monitor_produtos ADD COLUMN link_cartao TEXT;
CREATE TABLE IF NOT EXISTS alerta_cliques_diarios (
  dia TEXT NOT NULL,
  canal TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, canal)
);
