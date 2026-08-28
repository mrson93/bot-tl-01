# Confiabilidade e conversão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o bot regular, recuperável e confiável sem adicionar serviços pagos.

**Architecture:** O SQLite permanece como estado único, com migração automática para entregas por canal, preços históricos e próximo horário. A publicação passa a produzir resultados individuais por canal; formatação e rede ganham comportamentos testáveis e fallbacks simples.

**Tech Stack:** Python 3, biblioteca padrão (`sqlite3`, `unittest`) e `requests`; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-17-confiabilidade-e-conversao-design.md`

## Global Constraints

- Continuar gratuito e executar no GitHub Actions.
- Manter uma oferta por rodada.
- Preservar dados existentes de `postadas.db` por migração idempotente.
- Não adicionar dependências além das existentes.
- Nunca incluir segredos em código, documentação, logs ou testes.
- Botize permanece externo; fornecer somente seu modelo equivalente na documentação.

---

### Task 1: Estado persistente e migração

**Files:**
- Modify: `store.py`
- Create: `tests/test_store.py`

**Interfaces:**
- Produces: `avaliar_elegibilidade(oferta_id, preco, dias, queda_percent) -> str | None`, `registrar_entrega(...)`, `canais_pendentes(...)`, `proximo_post()`, `agendar_proximo_post(...)` e agregações do relatório.

- [ ] Escrever testes que criam bancos temporários e comprovam migração legada, bloqueio no mesmo dia, liberação por queda de 15%, entregas independentes e persistência do próximo horário.
- [ ] Executar os testes e confirmar falha pela ausência das novas interfaces.
- [ ] Implementar migração idempotente e as operações mínimas no SQLite.
- [ ] Executar os testes e confirmar sucesso.
- [ ] Commitar estado e testes.

### Task 2: Conteúdo confiável e fallback de publicação

**Files:**
- Modify: `telegram_poster.py`
- Modify: `bluesky.py`
- Create: `tests/test_formatacao.py`
- Create: `tests/test_publicacao.py`

**Interfaces:**
- Consumes: dicionário de oferta normalizado e link rastreado.
- Produces: `abertura`, `limpar_titulo`, `montar_legenda`, `montar_texto` e `postar`, mantendo as assinaturas públicas atuais.

- [ ] Escrever testes para os limites 39/40/70/71%, preço original verdadeiro, ausência de preço inventado, título completo e formatação brasileira.
- [ ] Executar e confirmar as falhas esperadas.
- [ ] Remover preço reconstruído e parcelamento; ajustar chamada e limpeza de título.
- [ ] Escrever teste de `sendPhoto` rejeitado seguido por `sendMessage` bem-sucedido.
- [ ] Implementar retry HTTP limitado e fallback sem foto no Telegram e Bluesky.
- [ ] Executar todos os testes e commitá-los com a implementação.

### Task 3: Orquestração, repetição e agendamento real

**Files:**
- Modify: `main.py`
- Modify: `config.py`
- Modify: `.env.example`
- Create: `tests/test_main.py`

**Interfaces:**
- Consumes: estado do Task 1 e canais do Task 2.
- Produces: seleção inédita/queda/repescagem, entrega por canal e `next_post_at` persistido.

- [ ] Escrever testes para intervalo inclusivo no pico, multiplicação fora do pico, execução precoce, tentativa curta sem oferta e falha isolada por canal.
- [ ] Executar e confirmar as falhas esperadas.
- [ ] Implementar configurações novas e substituir o sorteio recalculado por próximo horário persistido.
- [ ] Alterar publicação para registrar sucesso/falha por canal e só reenviar aos pendentes.
- [ ] Priorizar inéditas, depois quedas reais e depois repescagem.
- [ ] Executar a suíte e commitá-la com a implementação.

### Task 4: Relatório diário e observabilidade

**Files:**
- Create: `relatorio.py`
- Modify: `main.py`
- Modify: `config.py`
- Modify: `.env.example`
- Create: `tests/test_relatorio.py`

**Interfaces:**
- Consumes: agregações diárias de `store.py`, `TELEGRAM_ADMIN_ID` e `RELATORIO_HORA`.
- Produces: `enviar_se_devido(agora=None) -> bool`.

- [ ] Escrever testes para recurso desativado, horário ainda não atingido, resumo enviado e bloqueio do segundo envio diário.
- [ ] Executar e confirmar as falhas esperadas.
- [ ] Implementar resumo diário privado e logs sem dados sensíveis.
- [ ] Executar a suíte e commitá-la com a implementação.

### Task 5: Workflow, documentação e verificação integrada

**Files:**
- Modify: `.github/workflows/bot.yml`
- Modify: `LEIA-ME.md`
- Modify: `SUBIR-NA-NUVEM.md`
- Modify: `PROXIMOS-PASSOS.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: suíte `unittest` e variáveis novas.
- Produces: pipeline que testa antes de postar e falha quando o histórico não pode ser persistido.

- [ ] Atualizar Actions para versões atuais, executar `python -m unittest discover -v` antes da postagem e remover tolerância silenciosa do salvamento do banco.
- [ ] Documentar cron recomendado a cada cinco minutos, variáveis novas, restauração do backup, rotação de segredos e modelo Botize equivalente.
- [ ] Fazer busca por segredos acidentalmente versionados e por documentação obsoleta.
- [ ] Executar a suíte completa e `python main.py --check` com configuração controlada.
- [ ] Revisar o diff completo contra os critérios da especificação.
- [ ] Commitar documentação e workflow.
