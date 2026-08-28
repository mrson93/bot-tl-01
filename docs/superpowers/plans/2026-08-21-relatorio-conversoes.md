# Relatório privado de conversões — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Acrescentar ao resumo privado os pedidos e as comissões atribuídos ao AliExpress e à Shopee, separados por tracking, sem interferir na publicação de ofertas.

**Architecture:** Reutilizar os clientes e as assinaturas existentes em `aliexpress.py`
e `shopee.py`. Cada consulta retorna um dicionário agregado e sem identificadores de
pedidos; `relatorio.py` apenas formata os resultados e tolera a indisponibilidade
independente de cada API.

**Tech Stack:** Python 3.12, biblioteca padrão, requests, unittest e GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-21-relatorio-conversoes.md`

## Global Constraints

- Não adicionar dependências.
- Não publicar o relatório no canal público nem no Bluesky.
- Não registrar IDs de pedidos, compradores ou segredos.
- Falha no relatório não pode bloquear uma oferta.
- Usar o período móvel de sete dias para reduzir o efeito do atraso de atribuição.

---

### Task 1: Agregador de pedidos do AliExpress

**Files:**
- Modify: `aliexpress.py`
- Create: `tests/test_aliexpress_relatorio.py`

**Interfaces:**
- Consumes: `_chamar(metodo: str, negocio: dict) -> dict`
- Produces: `resumo_conversoes(inicio: datetime, fim: datetime) -> dict`

- [x] **Step 1: Write the failing tests**

Criar respostas literais para resultado vazio, pedidos pagos/liquidados/inválidos, tracking e comissão. Verificar que `resumo_conversoes()` devolve somente agregados.

- [x] **Step 2: Run tests to verify RED**

Run: `py -3 -m unittest tests.test_aliexpress_relatorio -v`

Expected: erro porque `resumo_conversoes` ainda não existe.

- [x] **Step 3: Write minimal implementation**

Consultar os três estados obrigatórios, normalizar a lista `orders.order`, somar comissão e agrupar `tracking_id`. Tratar `resp_code=405` com `The result is empty` como resultado vazio; outros códigos não bem-sucedidos geram erro.

- [x] **Step 4: Run tests to verify GREEN**

Run: `py -3 -m unittest tests.test_aliexpress_relatorio -v`

Expected: todos os testes passam.

- [x] **Step 5: Commit**

Commit: `feat: consultar conversoes do aliexpress`

### Task 2: Resumo privado enriquecido e resiliente

**Files:**
- Modify: `relatorio.py`
- Modify: `tests/test_relatorio.py`

**Interfaces:**
- Consumes: `aliexpress.resumo_conversoes(inicio, fim) -> dict`
- Produces: relatório privado com entregas de ontem e conversões dos últimos sete dias

- [x] **Step 1: Write the failing tests**

Verificar texto com pedidos, comissão e tracking; verificar também que uma exceção da API produz “indisponível” e ainda envia o resumo.

- [x] **Step 2: Run tests to verify RED**

Run: `py -3 -m unittest tests.test_relatorio -v`

Expected: falha porque o relatório ainda não consulta conversões.

- [x] **Step 3: Write minimal implementation**

Consultar o período móvel de sete dias, formatar reais em português e anexar a seção AliExpress. Capturar somente a falha da consulta para preservar o resumo operacional.

- [x] **Step 4: Run tests to verify GREEN**

Run: `py -3 -m unittest tests.test_relatorio -v`

Expected: todos os testes passam.

- [x] **Step 5: Commit**

Commit: `feat: incluir conversoes no resumo privado`

### Task 3: Estabilidade do histórico e documentação

**Files:**
- Modify: `.github/workflows/bot.yml`
- Create: `tests/test_workflow.py`
- Modify: `LEIA-ME.md`

**Interfaces:**
- Consumes: histórico persistido em `postadas.db`
- Produces: checkout sincronizado antes da rodada e instruções de ativação do relatório

- [x] **Step 1: Reuse the verified regression change**

Aplicar os commits já testados que sincronizam `main` antes de o bot ler o banco.

- [x] **Step 2: Document the report**

Explicar que `TELEGRAM_ADMIN_ID` recebe o relatório privado e que Shopee/cliques ainda dependem de relatório externo.

- [x] **Step 3: Run the full suite**

Run: `py -3 -m unittest discover -s tests -v`

Expected: todos os testes passam.

- [x] **Step 4: Run a real read-only AliExpress query**

Executar apenas `resumo_conversoes` com as credenciais locais, sem enviar mensagem nem publicar oferta. Confirmar que o retorno contém apenas agregados.

- [x] **Step 5: Commit**

Commit: `docs: explicar relatorio de conversoes`

### Task 4: Conversões da Shopee

**Files:**
- Modify: `shopee.py`
- Create: `tests/test_shopee_relatorio.py`
- Modify: `relatorio.py`
- Modify: `tests/test_relatorio.py`
- Modify: `LEIA-ME.md`

- [x] **Step 1: Confirm official API support**

Validar no esquema GraphQL oficial a consulta `conversionReport`, seus campos e a
paginação por `scrollId`. Fazer uma consulta real somente agregada, sem imprimir IDs.

- [x] **Step 2: Aggregate conversions safely**

Consultar apenas status, comissão e `utmContent`; somar pendentes, concluídas e
canceladas, comissão estimada/líquida e canal de origem. Não solicitar nem persistir
IDs de pedidos ou compradores.

- [x] **Step 3: Isolate failures and format report**

Anexar a seção Shopee ao resumo privado. Uma falha da Shopee não pode remover os
dados do AliExpress, nem uma falha do AliExpress remover os dados da Shopee.

- [x] **Step 4: Add regression tests and documentation**

Cobrir resultado vazio, agregação, valores monetários, paginação segura,
indisponibilidade independente e documentação do limite de cliques.
