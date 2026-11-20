-- Aviso mais vantajoso: maior preço entre as variações (Shopee) e o cupom do
-- produto (AliExpress), da última leitura. Só colunas novas; nada é recriado.
ALTER TABLE monitor_produtos ADD COLUMN preco_max REAL;
ALTER TABLE monitor_produtos ADD COLUMN cupom_codigo TEXT;
ALTER TABLE monitor_produtos ADD COLUMN cupom_condicao TEXT;
ALTER TABLE monitor_produtos ADD COLUMN cupom_expira_em INTEGER;
