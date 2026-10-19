# Registro de remediação da auditoria

Referência da auditoria: `origin/main @ aa9c8a7`, em 15/09/2026.

Este arquivo registra o estado das correções no código. O PDF permanece como a
fotografia somente leitura da situação encontrada antes da remediação.

| Item | Estado no código | Evidência principal |
| --- | --- | --- |
| SEC-01 — abuso de feedback | Corrigido | Deduplicação HMAC no servidor, rate limiter, limite real do corpo e remoção de qualquer supressão/aviso automático controlado por relatos. |
| SEC-02 — métricas e cliques manipuláveis | Corrigido | Deduplicação D1 por janela e cliente, rate limit no edge e redirecionamento disponível mesmo quando a telemetria falha fechado. |
| SEC-03 — cadeia Wrangler/sharp | Corrigido | Wrangler atualizado para 4.131.2 e lockfile resolvendo sharp 0.35.4; auditoria npm sem vulnerabilidades conhecidas. |
| SEC-04 — Actions por tag mutável | Corrigido | Todas as Actions externas estão fixadas por SHA completo, com a versão legível em comentário. |
| SEC-05 — limite baseado em Content-Length | Corrigido | Leitura incremental limitada em feedback e nos demais endpoints JSON de escrita. |
| CONF-01 — DNS rebinding em imagens | Mitigado no código | Download restrito a uma allowlist explícita de hosts oficiais, seguido da validação de endereços públicos e sem redirects. |
| CONF-02 — verificação Meta sem secret | Corrigido | Verificação GET exige secret e token não vazios e compara em tempo constante. |
| CONF-03 — controles externos | Parcial | 19/10/2026: GitHub com secret scanning, push protection, alertas e correções automáticas do Dependabot ativos, além de `.github/dependabot.yml` semanal. HSTS, CSP e cabeçalhos de segurança confirmados no domínio oficial. Pendentes: proteção da `main` e conferência de secrets, rate limiters e migrations nos painéis Cloudflare. |

## Validação executada

- 221 testes Python aprovados.
- 56 testes JavaScript aprovados após a remediação.
- Verificação sintática das Functions e Workers aprovada.
- Builds locais do Worker principal, agendador, redirecionador e Pages Functions aprovados com Wrangler 4.131.2.
- Auditoria npm: nenhuma vulnerabilidade conhecida.

## Implantação necessária

Antes de publicar, aplicar a migration `site/migrations/0012_public_abuse_protection.sql`,
configurar secrets e bindings e executar o checklist de `controles-externos.md`.
Nenhuma migration, secret, regra de painel ou implantação de produção foi executada
durante esta remediação.
