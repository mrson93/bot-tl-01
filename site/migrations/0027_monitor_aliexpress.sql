-- Monitor de preços passa a aceitar o AliExpress (id_produto = número do item).
-- O SQLite não altera CHECK: a tabela é recriada com os mesmos dados e ids.
CREATE TABLE monitor_produtos_novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loja TEXT NOT NULL CHECK (loja IN ('amazon','mercadolivre','shopee','aliexpress')),
  id_produto TEXT NOT NULL,
  tipo TEXT,
  nome TEXT,
  categoria TEXT,
  link_afiliado TEXT,
  imagem TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  canal INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL,
  UNIQUE (loja, id_produto)
);
INSERT INTO monitor_produtos_novo (id,loja,id_produto,tipo,nome,categoria,link_afiliado,imagem,ativo,canal,criado_em)
  SELECT id,loja,id_produto,tipo,nome,categoria,link_afiliado,imagem,ativo,canal,criado_em FROM monitor_produtos;
DROP TABLE monitor_produtos;
ALTER TABLE monitor_produtos_novo RENAME TO monitor_produtos;
