-- Monitor de preços com histórico (só posta quando a oferta é de verdade).
-- Os produtos são cadastrados pelos comandos /add e /remover do painel privado
-- e as leituras vêm das APIs oficiais das lojas, a cada 2 horas.

CREATE TABLE IF NOT EXISTS monitor_produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loja TEXT NOT NULL CHECK (loja IN ('amazon','mercadolivre')),
  id_produto TEXT NOT NULL,              -- ASIN ou MLB
  tipo TEXT,                             -- Mercado Livre: 'catalogo' (/p/MLB...) ou 'anuncio'
  nome TEXT,
  categoria TEXT,
  link_afiliado TEXT,
  imagem TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL,
  UNIQUE (loja, id_produto)
);

CREATE TABLE IF NOT EXISTS monitor_leituras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  preco REAL,                            -- vazio quando a loja não informa preço
  preco_antigo REAL,                     -- o "de R$" exibido pela loja (só registro)
  disponivel INTEGER NOT NULL,
  lido_em INTEGER NOT NULL               -- epoch em segundos
);
CREATE INDEX IF NOT EXISTS idx_monitor_leituras_produto ON monitor_leituras (produto_id, lido_em);

CREATE TABLE IF NOT EXISTS monitor_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  preco REAL NOT NULL,
  motivo TEXT NOT NULL,
  postado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitor_posts_produto ON monitor_posts (produto_id, postado_em);
CREATE INDEX IF NOT EXISTS idx_monitor_posts_data ON monitor_posts (postado_em);

-- Ofertas aprovadas na madrugada (23h às 7h): saem na primeira rodada da manhã,
-- se o preço ainda passar na regra.
CREATE TABLE IF NOT EXISTS monitor_fila (
  produto_id INTEGER PRIMARY KEY,
  preco REAL NOT NULL,
  entrou_em INTEGER NOT NULL
);
