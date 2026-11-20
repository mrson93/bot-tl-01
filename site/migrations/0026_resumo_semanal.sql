-- Resumo semanal do bot de alertas: uma linha por pessoa que tem alerta de
-- produto. Guarda só o chat_id, se o resumo está ligado e quando saiu o último.
CREATE TABLE IF NOT EXISTS alerta_pessoas (
  chat_id TEXT PRIMARY KEY,
  resumo_semanal INTEGER NOT NULL DEFAULT 1,  -- ligado por padrão; botão 🔕 desliga
  resumo_enviado_em INTEGER                   -- último resumo enviado (epoch)
);
