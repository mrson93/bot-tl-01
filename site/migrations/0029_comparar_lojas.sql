-- Comparar lojas: a opção parecida mais barata em outra loja (JSON) e quando
-- foi procurada. Vale por 12 h; null em comparacao = nada parecido encontrado.
ALTER TABLE monitor_produtos ADD COLUMN comparacao TEXT;
ALTER TABLE monitor_produtos ADD COLUMN comparado_em INTEGER;
