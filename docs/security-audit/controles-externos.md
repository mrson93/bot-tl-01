# Baseline de segurança externo

Este checklist completa as correções versionadas sem registrar IDs pessoais,
tokens, chaves ou valores de secrets. A validação deve ser feita nos painéis
Cloudflare e GitHub por uma pessoa autorizada.

## Cloudflare Pages - site

- Criar `ABUSE_HASH_SECRET` como secret de produção e preview com pelo menos 32
  caracteres aleatórios. Não reutilizar `PUBLISH_TOKEN`.
- Aplicar `site/migrations/0012_public_abuse_protection.sql` ao D1.
- Configurar `FEEDBACK_RATE_LIMITER`: 10 chamadas por 60 segundos.
- Configurar `METRICS_RATE_LIMITER`: 60 chamadas por 60 segundos.
- Confirmar que `PUBLISH_TOKEN`, `META_APP_SECRET`,
  `META_WEBHOOK_VERIFY_TOKEN` e `META_PAGE_ACCESS_TOKEN` existem como secrets.
- Confirmar HSTS na resposta do domínio oficial e regras WAF gerenciadas ativas.
- Implantar primeiro em preview e validar respostas 413, 429, 503 e deduplicação.

## Cloudflare Worker - redirecionador

- Aplicar `redirector/schema.sql` ao D1; os comandos são idempotentes.
- Criar `ABUSE_HASH_SECRET` próprio, diferente do site e do `ADMIN_TOKEN`.
- Confirmar o binding `CLICK_RATE_LIMITER` de 60 chamadas por 60 segundos.
- Confirmar que `ADMIN_TOKEN` existe como secret e possui ao menos 32 caracteres.
- Validar que dois acessos iguais na janela redirecionam, mas geram um só clique.

## GitHub

- Ativar proteção de `main`, exigir CI aprovado e impedir force-push/delete.
- Ativar secret scanning, push protection e Dependabot alerts/updates.
- Confirmar que Actions externas permanecem fixadas por SHA completo.
- Revisar acesso aos environments/secrets e remover colaboradores sem necessidade.
- Registrar somente data, responsável e estado do controle; nunca copiar valores.

## Evidência de aceite

Registrar, sem screenshots contendo identificadores ou segredos:

- data e responsável pela revisão;
- nome lógico de cada regra/binding;
- estado ativo/inativo;
- resultado dos testes de preview;
- data prevista para a próxima revisão trimestral.
