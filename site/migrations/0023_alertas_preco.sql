-- Alertas de preço por produto no bot público (@TaBaratoAlertaDePrecoBot).
-- A pessoa cola o link do produto, com ou sem preço desejado. A coleta do
-- monitor lê o preço a cada 2 h e o site avisa quem pediu.

-- canal=1: produto cadastrado pelo admin (/add), pode ir para o canal.
-- canal=0: produto só do público, serve apenas para os avisos individuais.
ALTER TABLE monitor_produtos ADD COLUMN canal INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS alerta_precos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,                 -- só o id numérico do Telegram
  produto_id INTEGER NOT NULL,
  preco_alvo REAL,                       -- vazio: avisar no menor preço real
  ativo INTEGER NOT NULL DEFAULT 1,      -- alerta com preço pausa depois de avisar
  criado_em INTEGER NOT NULL,
  expira_em INTEGER NOT NULL,
  ultimo_aviso_em INTEGER,
  ultimo_aviso_preco REAL,
  UNIQUE (chat_id, produto_id)
);
CREATE INDEX IF NOT EXISTS idx_alerta_precos_produto ON alerta_precos (produto_id, ativo);
