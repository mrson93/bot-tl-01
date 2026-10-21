-- Alertas por palavra-chave do bot público. Guarda só o chat_id numérico do
-- Telegram e as palavras escolhidas; /parar apaga tudo da pessoa.
CREATE TABLE IF NOT EXISTS alert_subscriptions (chat_id TEXT NOT NULL,keyword TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY (chat_id,keyword));
CREATE TABLE IF NOT EXISTS alert_deliveries (chat_id TEXT NOT NULL,offer_id TEXT NOT NULL,sent_at INTEGER NOT NULL,PRIMARY KEY (chat_id,offer_id));
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_sent ON alert_deliveries(chat_id,sent_at);
