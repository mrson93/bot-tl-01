-- Marca de campanha da própria loja na oferta (ex.: selo "Oferta Black Friday"
-- da Amazon), com a data em que foi vista por último, para a página /black-friday.
ALTER TABLE offers ADD COLUMN campaign TEXT;
ALTER TABLE offers ADD COLUMN campaign_at INTEGER;
