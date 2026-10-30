-- Cópia da lista de ideias da Amazon enviada pela extensão do navegador.
-- Guarda o HTML de cada página do "Carregar mais"; cada envio substitui o anterior.
CREATE TABLE IF NOT EXISTS amazon_list_pages (list_id TEXT NOT NULL,idx INTEGER NOT NULL,html TEXT NOT NULL,captured_at INTEGER NOT NULL,PRIMARY KEY (list_id,idx));
