-- Indicação: cada pessoa tem um código aleatório (link ?start=r_<código>);
-- quem chega por ele fica com indicado_por, e conta quando cria o 1º alerta.
ALTER TABLE alerta_pessoas ADD COLUMN codigo TEXT;
ALTER TABLE alerta_pessoas ADD COLUMN indicado_por TEXT;
ALTER TABLE alerta_pessoas ADD COLUMN indicacao_contada_em INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerta_pessoas_codigo ON alerta_pessoas (codigo);
CREATE INDEX IF NOT EXISTS idx_alerta_pessoas_indicado ON alerta_pessoas (indicado_por);
