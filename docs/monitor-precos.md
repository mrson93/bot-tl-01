# Monitor de preços com histórico

Posta no canal do Telegram só quando a oferta é de verdade: o menor preço real
do período ou um preço bem abaixo da média, com o link de afiliado.

## Como funciona

| Parte | Onde roda | O que faz |
|---|---|---|
| Comandos `/add`, `/remover`, `/lista`, `/historico <id>`, `/teste_monitor` | Worker `telegram-control` (D1 pelo binding `MONITOR_DB`) | Cadastra e consulta os produtos. Só responde ao `TELEGRAM_ADMIN_ID`. |
| Disparo a cada 2 h | Cron do `bot-tl-01-scheduler`, que chama o `telegram-control` | No minuto 7 das horas pares (horário de Brasília), pede ao GitHub a rodada `monitor_precos`. Não dispara com o bot pausado. |
| Coleta e posts | `monitor_precos.py` no GitHub Actions | Lê os preços pelas APIs oficiais, grava o histórico pela rota `/api/monitor` do site e posta o que passar na regra. |
| Tabelas | D1 `canaltabarato-ofertas` | `monitor_produtos`, `monitor_leituras`, `monitor_posts`, `monitor_fila`. |

A coleta fica no Python porque o Mercado Livre troca o refresh token a cada
renovação. Um segundo cliente renovando o token por conta própria derrubaria o
outro. As rodadas do monitor usam o mesmo grupo de concorrência do bot, então
nunca renovam ao mesmo tempo.

### Lojas

- **Mercado Livre:** API oficial com OAuth, a mesma que o bot já usa. Lê o
  produto de catálogo (`/p/MLB…`) ou o anúncio (`MLB-…`).
- **Amazon:** Creators API. Hoje ela recusa a conta com `403 AssociateNotEligible`.
  A Amazon libera o acesso sozinha depois de **10 vendas qualificadas em 30 dias**.
  O bot testa uma vez por dia e avisa no privado quando liberar. Até lá, os
  produtos da Amazon ficam cadastrados, mas sem leitura. Não há scraping.

### Regra de "oferta de verdade"

Só posta se **todas** as condições forem verdadeiras:

1. O produto está em estoque.
2. O produto tem pelo menos 7 dias de histórico. Antes disso, só coleta.
3. O preço é o menor dos últimos 90 dias (e pelo menos 3% abaixo da média),
   **ou** está pelo menos 15% abaixo da média dos últimos 30 dias.
4. **Desconto falso:** os dias dos últimos 15 em que o preço ficou mais de 10%
   acima da mediana não entram na média. Uma "queda" que é só a volta do pico ao
   normal não conta como oferta. O "preço antigo" que a loja exibe fica gravado,
   mas nunca serve de comparação.
5. O produto não foi postado nas últimas 72 h, a não ser que o preço tenha
   caído mais 5% desde o último post.
6. No máximo 8 posts por dia, e nenhum entre 23h e 7h (horário de Brasília).
   O que for aprovado na madrugada vai para a fila e sai na primeira rodada
   depois das 7h, se o preço ainda passar na regra.

O histórico usa o menor preço com estoque de cada dia. Se houver menos de 90
dias de histórico, o post diz "MENOR PREÇO EM N DIAS", com o número real de dias.

## Configuração

Todos os números ficam em variáveis do GitHub (Settings → Secrets and variables
→ Actions → Variables). Se uma variável ficar vazia, vale o padrão:

| Variável | Padrão | O que controla |
|---|---|---|
| `MONITOR_ATIVO` | `true` | Liga ou desliga os posts e a coleta |
| `MONITOR_QUEDA_MEDIA_PERCENT` | `15` | % abaixo da média para postar |
| `MONITOR_QUEDA_REPOST_PERCENT` | `5` | Queda extra para repostar antes de 72 h |
| `MONITOR_MIN_ABAIXO_MEDIA_PERCENT` | `3` | No critério "menor preço", o mínimo abaixo da média |
| `MONITOR_PICO_PERCENT` | `10` | Quanto acima da mediana conta como pico |
| `MONITOR_DIAS_MINIMOS` | `7` | Dias de histórico antes de poder postar |
| `MONITOR_DIAS_MEDIA` | `30` | Janela da média |
| `MONITOR_DIAS_MINIMO` | `90` | Janela do menor preço (máx. 120) |
| `MONITOR_DIAS_PICO` | `15` | Janela do desconto falso |
| `MONITOR_HORAS_REPOST` | `72` | Intervalo mínimo entre posts do mesmo produto |
| `MONITOR_LIMITE_DIARIO` | `8` | Posts por dia |
| `MONITOR_SILENCIO_INICIO` / `MONITOR_SILENCIO_FIM` | `23` / `7` | Horas sem post |
| `MONITOR_PAUSA_SEGUNDOS` | `0.5` | Pausa entre leituras (limite de requisições) |

No Worker (`telegram-control/wrangler.jsonc`, em `vars`):
`MONITOR_INTERVALO_HORAS` (padrão `2`), `MONITOR_DIAS_HISTORICO` (padrão `90`,
usado no `/historico`) e `MONITOR_ATIVO` (`false` para de disparar a coleta).

O monitor não usa nenhum segredo novo. Os que ele usa já existem:
`TELEGRAM_BOT_TOKEN`, `SITE_API_TOKEN`, as credenciais do Mercado Livre e da
Amazon (GitHub) e os secrets do Wrangler do `telegram-control`.

## Deploy

Rode os comandos na pasta do projeto, nesta ordem.

1. Crie as tabelas no D1:

   ```bash
   npx wrangler d1 execute canaltabarato-ofertas --remote --file=site/migrations/0022_monitor_precos.sql
   ```

2. Mande o código para o GitHub. O push publica o site (com a rota
   `/api/monitor`) e o bot passa a aceitar as rodadas do monitor:

   ```bash
   git push origin main
   ```

3. Publique o Worker do painel (comandos e disparo a cada 2 h):

   ```bash
   cd telegram-control && npx wrangler deploy
   ```

4. No chat de admin, mande `/teste_monitor`. Em 1 a 2 minutos chega a prévia de
   um post com histórico falso, sem ir para o canal.

5. Cadastre os produtos com `/add <link>` e confira com `/lista`. O primeiro post
   de um produto só pode sair depois de 7 dias de coleta.

Para desligar sem apagar nada, defina a variável do GitHub `MONITOR_ATIVO=false`.
Para parar também o disparo, mude `MONITOR_ATIVO` para `"false"` no
`wrangler.jsonc` e rode `npx wrangler deploy` de novo.

## Alertas de preço do bot público (@TaBaratoAlertaDePrecoBot)

O bot público de alertas (código em `site/functions/_telegram_alerts.js` e
`site/functions/_price_alerts.js`) usa a mesma coleta:

- A pessoa cola o link de um produto do Mercado Livre, com ou sem preço
  (`https://… 199,90`). Com preço, recebe um aviso quando o preço chegar nele e
  o alerta pausa. Sem preço, recebe quando for o menor preço real, pela mesma
  regra do canal, no máximo a cada 72 h (ou se cair mais 5%).
- Os produtos do público ficam em `monitor_produtos` com `canal=0`: são lidos a
  cada 2 h, mas **nunca** vão para o canal. Só os do `/add` (`canal=1`) vão.
- A coleta decide quem avisar e manda a lista para `/api/monitor`. O site
  entrega a mensagem com o token do bot (`TELEGRAM_ALERTS_BOT_TOKEN`, que fica
  só no site). Entre 23h e 7h o aviso chega sem som.
- Limites (variáveis do site no Cloudflare Pages): `ALERTA_MAX_PRODUTOS_POR_PESSOA`
  (5), `ALERTA_MAX_PRODUTOS_TOTAL` (300) e `ALERTA_DIAS_VALIDADE` (90). O
  alerta vencido é pausado e a pessoa recebe um aviso.
- `/parar` apaga tudo da pessoa, e quem bloqueia o bot é apagado sozinho.
- Os cliques dos avisos passam pelo `go.` com o canal `alerta`.

Para ativar, aplique a migração `site/migrations/0023_alertas_preco.sql` no D1
**antes** do push, porque a rota `/api/monitor` passa a consultar `alerta_precos`:

```bash
npx wrangler d1 execute canaltabarato-ofertas --remote --file=/Users/emersonpettorini/Documents/IA/bot-envio-ofertas-automaticamente/site/migrations/0023_alertas_preco.sql
```

Depois faça o push (publica o site) e rode `npx wrangler deploy` em
`telegram-control` (o `/lista` passa a separar os produtos do público, e o
painel ganha o botão da campanha do bot de alertas).

## Bot de alertas completo (migração 0025)

- **Cartão de cada alerta** com botões: menor preço do histórico, valor
  desejado, queda de 10/20/30% (a partir do preço de quando ligou), volta ao
  estoque (só Mercado Livre), prazo (1, 3, 6 ou 12 meses; padrão 1 ano), ver na
  loja e apagar. Mostra preço atual, menor e maior do histórico e um mini
  gráfico de 30 dias.
- **Menu fixo** na conversa: ➕ Novo alerta · 📋 Meus alertas · ❓ Ajuda.
- **Avisos** com foto, histórico e botões 🛒 Comprar · 🔁 Avisar se cair mais ·
  ⚙️ Ajustar · ✋ Parar. O aviso de valor pausa o alerta só se ele for o único
  aviso ligado; o de queda passa a contar do novo preço.
- **Vencimento**: lembrete 7 dias antes, com botão para renovar por 1 ano.
- **Histórico de 1 ano**: as leituras com mais de 30 dias viram uma por dia (o
  menor preço com estoque), uma vez por dia, para o D1 não crescer demais.
- **Limites** padrão: 10 produtos por pessoa e 1.000 no total
  (`ALERTA_MAX_PRODUTOS_POR_PESSOA`, `ALERTA_MAX_PRODUTOS_TOTAL`, `ALERTA_DIAS_VALIDADE`).

## Gráfico e termômetro (etapa 1 do plano)

- **📈 Gráfico** no cartão e no aviso: PNG desenhado no próprio site
  (`site/functions/_price_chart.js`, paleta de 9 cores, `CompressionStream`),
  com o menor preço de cada dia, menor (verde), maior (vermelho), último preço
  e o valor pedido tracejado. Vai por upload (multipart), sem link público.
  Botões 30 dias · 90 dias · 1 ano trocam a mesma foto (`editMessageMedia`).
  Precisa de pelo menos 2 dias com leitura.
- **Termômetro** no cartão, no aviso, na lista e na legenda do gráfico: compara
  o preço com o menor preço de cada dia do último ano. Entre os 25% mais
  baratos 🟢 preço baixo; entre os 25% mais caros 🔴 preço alto; no meio 🟡 na
  média. Com menos de 14 dias mostra "juntando histórico" (na lista, nada).
- **Botões dentro das mensagens** precisam do webhook com `callback_query`. O
  site confere isso a cada coleta (`_alert_bot_setup.js`) e corrige sozinho,
  com o token e o segredo que já tem, junto com o menu de comandos e a descrição.
- **Admin**: `/estatisticas` no painel mostra pessoas, alertas por tipo e
  origem, produtos por loja, avisos enviados e os produtos com mais alertas.

## Busca pelo nome (etapa 2 do plano)

- `🔎 Buscar produto` no menu, `/buscar air fryer` ou só o nome solto.
  O botão do menu pede o nome com o campo de resposta do Telegram (force_reply).
- Fontes (`site/functions/_product_search.js`): até 3 do catálogo do site
  (tabela `offers`, só Mercado Livre e Shopee) e a Shopee ao vivo pela API de
  afiliados completa até 5. A Shopee só entra com `SHOPEE_APP_ID` e
  `SHOPEE_SECRET` nos secrets do Cloudflare Pages; sem eles, ou com erro, fica
  só o catálogo.
- Produto já acompanhado mostra há quantos dias e o termômetro.
- Botão numerado cria o alerta (origem `busca`). Da Shopee, o site lê nome e
  preço na hora e grava como primeira leitura.
- Botão "🔔 Avisar quando o canal postar …" cria o alerta por palavra antigo.

## Resumo semanal e maiores quedas (etapa 3 do plano)

- **Resumo semanal** (`site/functions/_weekly_summary.js`): sai com a coleta,
  segunda a partir das 10h (atrasados até terça), em lotes de 50 por coleta.
  Por produto: preço de agora, comparação com 7 dias atrás, menor da semana e
  termômetro. Só vai para quem tem produto com leitura na semana. Ligado por
  padrão; tabela `alerta_pessoas` (migração 0026) guarda `resumo_semanal` e
  `resumo_enviado_em`. `/parar` e bloqueio apagam a linha.
- **Maiores quedas de hoje** (`site/functions/_price_drops.js`): leitura das
  últimas 6 h com estoque contra a última leitura entre 30 h e 20 h atrás,
  queda de 5% ou mais, só produtos com nome e link de afiliado. Página
  `/quedas-de-hoje` (aba "Hoje"), JSON público em `/api/quedas-de-hoje`.
  Não mostra quem monitora nem quantas pessoas.
- **Post diário no canal** (`monitor_precos.postar_quedas_do_dia`): primeira
  coleta depois de `MONITOR_QUEDAS_HORA` (20h), só com `MONITOR_QUEDAS_MINIMO`
  (3) quedas ou mais; o dia fica marcado em `monitor_quedas_dia` no estado do
  bot. Desliga com `MONITOR_QUEDAS_ATIVO=false`.

## AliExpress (etapa 4 do plano)

- Migração 0027: `monitor_produtos.loja` aceita `aliexpress` (`id_produto` é o
  número do item).
- Links: `aliexpress.com/item/<id>.html` ou `/i/<id>.html` (pt., m., www.),
  `a.aliexpress.com/_…` (compartilhar) e `s.click.aliexpress.com/e/…`
  (afiliado). O site segue redirecionamentos só dentro do AliExpress e lê o
  `redirectUrl` da página de compartilhamento.
- Coleta: `aliexpress.consultar_monitor` (productdetail.get, lotes de 20),
  preço normal do site (`target_sale_price`), sem estoque: produto que some da
  resposta conta como indisponível. Link de afiliado por `link.generate`.
- Bot: avisos de menor preço, valor e queda %; sem "voltar ao estoque". Busca
  inclui o AliExpress do catálogo; posts do canal ganham `?start=ae_<id>`.

## Variações e cupom (etapa 5 do plano)

- Migração 0028: `monitor_produtos` ganha `preco_max` (maior preço entre as
  variações da Shopee) e `cupom_codigo`, `cupom_condicao`, `cupom_expira_em`
  (cupom do item no AliExpress). A coleta manda esses campos na leitura; o
  site grava a cada leitura e `null` apaga (cupom que sumiu ou venceu).
- Cartão, aviso e `/quedas-de-hoje`: "a partir de R$ X (as opções vão até
  R$ Y)" e "🎟 Cupom <code>APP20</code>: condição · até dd/mm". O alerta
  continua pela variação mais barata.
- Sem cupom do produto, o aviso mostra o voucher geral válido da loja da tabela
  `coupons` (se houver), com destino só nos domínios da loja.

## Comparar lojas (etapa 6 do plano)

- `site/functions/_compare_stores.js`: procura o produto pelo nome no catálogo
  do site (outras lojas, link pelo `/go`) e na Shopee ao vivo (`offerLink`).
  Regra do "parecido": números e códigos de modelo iguais, mesmas versões
  (Ultra, Pro, Max…), pelo menos 3 palavras e 75% das palavras do nome, preço
  entre 50% e 150% do atual.
- Migração 0029: `monitor_produtos.comparacao` (JSON da melhor opção) e
  `comparado_em`; vale 12 h, inclusive "nada encontrado".
- Cartão e aviso: "💡 Parecido na Shopee por R$ X (N% menos). Confira se é o
  mesmo modelo." com botão, só se a outra loja estiver 2% mais barata. A
  entrega de avisos faz no máximo 5 buscas novas por coleta.

## Perfil do bot

- `_alert_bot_setup.js` compara a descrição publicada com `DESCRICAO`; se for
  diferente, atualiza comandos, descrição curta, foto (`setMyProfilePhoto`
  com `public/bot/alerta-icone.jpg`) e, por último, a descrição. Se a foto
  falhar, tenta de novo na coleta seguinte. Fonte do ícone:
  `public/bot/alerta-icone.svg`.

## Modo inline (etapa 7 do plano)

- `@TaBaratoAlertaDePrecoBot fone` em qualquer conversa (modo inline ligado no
  @BotFather com `/setinline`). `site/functions/_inline.js` usa a busca da
  etapa 2 e devolve artigos com foto, preço, loja, histórico e termômetro;
  botões "🛒 Ver na loja" e "🔔 Criar alerta de preço" (`?start=ml_|sp_|ae_`).
  Consulta com menos de 3 letras não busca; `cache_time` 300 s; nada é gravado.
- O webhook recebe `inline_query` (`ATUALIZACOES`). Na primeira mensagem de
  cada instância do site, `garantirConfiguracao` confere webhook, descrição e
  foto (antes só rodava na coleta).

## Mini app (etapa 8 do plano)

- Página `/app/alertas` (`site/functions/app/alertas.js`, com
  `public/miniapp/alertas.js` e `.css`), cores do tema do Telegram.
- Login: o `initData` vai no cabeçalho `X-Telegram-Init-Data`;
  `_webapp_auth.js` confere o HMAC (chave = HMAC_SHA256("WebAppData", token))
  e aceita até 24 h. Nada novo é guardado.
- API `_webapp_api.js`: `GET/POST /api/app/alertas` (lista, detalhe, ajustes)
  e `GET /api/app/grafico?id=&dias=` (PNG). Os ajustes passam pelos mesmos
  caminhos dos botões do cartão (`handleCallback`, `definirValor`).
- Botão de menu do bot (`setChatMenuButton`, conferido junto com o perfil) e
  "📱 Abrir painel" no topo de Meus alertas.

## Indicação (etapa 9 do plano)

- `site/functions/_referral.js`. Migração 0030: `alerta_pessoas` ganha `codigo`
  (aleatório, índice único), `indicado_por` e `indicacao_contada_em`.
- Link `t.me/TaBaratoAlertaDePrecoBot?start=r_<código>`. Só marca quem nunca
  teve alerta de produto e não é a própria pessoa; o primeiro convite vale.
- Conta quando o amigo cria o 1º alerta (`contarIndicacao` em
  `cadastrarAlerta`), uma vez; quem indicou recebe aviso sem saber quem foi.
- Limite por pessoa = base (`ALERTA_MAX_PRODUTOS_POR_PESSOA`, 10) + amigos ×
  `ALERTA_BONUS_POR_AMIGO` (5), até `ALERTA_MAX_COM_BONUS` (30). `/parar`
  apaga a linha do amigo e ele deixa de contar.
- `/convidar`, botão "🎁 Convidar amigos" em Meus alertas e no aviso de limite
  cheio, com botão de compartilhar (`t.me/share/url`). Comandos do bot são
  conferidos na primeira mensagem de cada instância (`getMyCommands`).

