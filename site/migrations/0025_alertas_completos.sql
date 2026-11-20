-- Bot de alertas completo: vários tipos de aviso por alerta, prazo escolhido
-- pela pessoa (padrão 1 ano), lembrete de vencimento e registro dos avisos.
ALTER TABLE alerta_precos ADD COLUMN avisar_menor INTEGER NOT NULL DEFAULT 0;   -- menor preço do histórico
ALTER TABLE alerta_precos ADD COLUMN queda_percent REAL;                        -- avisar se cair X% desde preco_base
ALTER TABLE alerta_precos ADD COLUMN avisar_estoque INTEGER NOT NULL DEFAULT 0; -- voltou ao estoque
ALTER TABLE alerta_precos ADD COLUMN preco_base REAL;                           -- referência da queda %
ALTER TABLE alerta_precos ADD COLUMN origem TEXT;                               -- link, canal
ALTER TABLE alerta_precos ADD COLUMN editando_em INTEGER;                       -- tocou em "Valor" e vai digitar
ALTER TABLE alerta_precos ADD COLUMN lembrete_em INTEGER;                       -- aviso de vencimento enviado

-- Quem não tinha valor era alerta de "menor preço"; o prazo passa a 1 ano.
UPDATE alerta_precos SET avisar_menor=1 WHERE preco_alvo IS NULL;
UPDATE alerta_precos SET expira_em=criado_em+365*86400 WHERE ativo=1 AND expira_em<criado_em+365*86400;

CREATE TABLE IF NOT EXISTS alerta_avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alerta_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  produto_id INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  preco REAL NOT NULL,
  enviado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerta_avisos_data ON alerta_avisos (enviado_em);
