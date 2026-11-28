-- "Verificado em" dos cupons: quando o cupom foi conferido pela última vez
-- (cópia da página de cupons do Mercado Livre, ou o radar o viu de novo no
-- canal de origem).
ALTER TABLE coupons ADD COLUMN verified_at INTEGER;
UPDATE coupons SET verified_at=published_at WHERE verified_at IS NULL;
