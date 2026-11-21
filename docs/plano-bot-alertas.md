# Plano: bot de alertas no nível dos melhores (14 ideias)

Bot: **@TaBaratoAlertaDePrecoBot**. Comparação feita com Keepa, camelcamelcamel,
Zoom/Buscapé, Pelando/Promobit e bots de rastreio de preço do Telegram
(20/11/2026). Uma etapa por vez: plano curto → aprovação → código e testes →
migração/push/deploy com OK explícito → teste no Telegram.

Como o sistema funciona hoje: [monitor-precos.md](monitor-precos.md).

## Etapas

### Etapa 1 — Cartão que responde "compro agora?" (ideias 1 e 3)
- [x] **Gráfico de preço como imagem** (90 dias / 1 ano), com mínimo e máximo
  marcados, no cartão (botão 📈 Gráfico) e no aviso.
  - Decisão: gerar o PNG no próprio site (Worker desenha a linha e comprime com
    `CompressionStream`), sem serviço de terceiros. Alternativa mais rápida:
    QuickChart.io (envia só datas e preços, nada da pessoa).
  - Feito em 20/11/2026: gerado no site, com períodos 30 dias, 90 dias e 1 ano.
- [x] **Termômetro**: 🟢 preço baixo · 🟡 na média · 🔴 caro, comparando o preço
  atual com o histórico (percentil do último ano). No cartão, no aviso e na lista.

### Etapa 2 — Buscar pelo nome (ideia 2)
- [x] `🔎 Buscar produto` no menu: a pessoa digita "air fryer mondial", recebe
  até 5 resultados com foto/preço em botões e cria o alerta com um toque.
- Shopee: a API de afiliados aceita busca por palavra (`productOfferV2(keyword)`),
  mas as credenciais da Shopee estão só no GitHub. Precisa cadastrar
  `SHOPEE_APP_ID` e `SHOPEE_SECRET` também como secrets do site (Cloudflare Pages),
  pela pessoa dona da conta.
- Mercado Livre: testar se a busca da API (`/sites/MLB/search`) responde com o
  acesso atual; se não, a busca fica só na Shopee.
- Feito em 20/11/2026: busca no catálogo do site (ML e Shopee que o canal já
  postou) + Shopee ao vivo quando as chaves estiverem no site. A busca do ML
  recusa sem token (403) e o token do ML só pode ficar no Python (troca a cada
  uso), então o ML entra pelo catálogo. Texto solto virou busca; o alerta por
  palavra continua no botão dos resultados e em `/alerta palavra`.

### Etapa 3 — Volta ao bot e ao canal (ideias 4 e 11)
- [x] **Resumo semanal opcional** (segunda, 10h): "seus produtos: 2 caíram, 1 subiu,
  menor preço foi…". Liga/desliga em ⚙️ Preferências; desligado por padrão? decidir.
- [x] **Maiores quedas de hoje**: ranking dos produtos monitorados (canal + público)
  que mais caíram nas últimas 24 h, sem expor quem monitora. Vira post diário no
  canal (campanha) e página no site (`/quedas-de-hoje`).
- Feito em 20/11/2026: resumo ligado por padrão (botão 🔕 em todo resumo e
  ⚙️ em Meus alertas); quedas = preço de agora contra 24 h atrás, mínimo 5%;
  post no canal na primeira coleta depois das 20h, só com 3 quedas ou mais.

### Etapa 4 — AliExpress nos alertas (ideia 5)
- [x] Reconhecer links `aliexpress.com/item/<id>.html` e `s.click.aliexpress.com`.
- [x] Leitura pela API de afiliados do AliExpress que o bot já usa (`aliexpress.py`).
- [x] Migração: `monitor_produtos.loja` aceitar `aliexpress` (recria a tabela, como na 0024).
- Feito em 20/11/2026 (migração 0027): links item/i, pt./m./www., a.aliexpress
  e s.click (redirecionamento só dentro do AliExpress); preço normal do site
  (não o exclusivo do app); sem aviso de estoque; busca pelo catálogo; botão
  `ae_` nos posts do canal. O `/add` do painel continua sem AliExpress.

### Etapa 5 — Aviso mais vantajoso (ideias 7 e 8)
- [x] **Cupom no aviso**: se houver cupom válido da loja (o bot já busca cupons da
  Shopee), ele aparece no aviso e no cartão.
- [x] **Variações na Shopee**: guardar `priceMin`/`priceMax`; avisar pela variação
  mais barata e mostrar "a partir de".
- Feito em 20/11/2026 (migração 0028): cupom por produto só existe na API do
  AliExpress (`promo_code_info`); a tabela `coupons` estava vazia, então o
  voucher geral da loja aparece só quando houver um válido. Shopee guarda
  `preco_max` e o aviso diz "a partir de".

### Etapa 6 — Comparar lojas (ideia 6)
- [x] No cartão e no aviso: "na Shopee está R$ X" buscando o mesmo produto pelo
  nome nas outras lojas. Mostrar como **sugestão** (pode não ser idêntico), com
  link de afiliado. Depende da busca da etapa 2.
- Feito em 20/11/2026 (migração 0029): catálogo do site (todas as lojas, via
  /go) + Shopee ao vivo; números, códigos de modelo e versões (Ultra, Pro…)
  têm que bater e 75% das palavras; preço entre 50% e 150%; só aparece se a
  outra loja estiver 2% mais barata. Guardado 12 h; avisos fazem no máximo 5
  buscas novas por coleta. Junto: foto nova do bot (setMyProfilePhoto) e
  descrição atualizada, aplicadas pelo site na coleta seguinte ao deploy.

### Etapa 7 — Modo inline (ideia 9)
- [x] Em qualquer conversa: `@TaBaratoAlertaDePrecoBot fone` → resultados com
  histórico e botão "Criar alerta".
- Precisa ligar o modo inline no @BotFather (`/setinline`) — só a pessoa dona do
  bot faz — e incluir `inline_query` no webhook (`_alert_bot_setup.js`).
- Feito em 20/11/2026: `/setinline` feito pelo dono; resultados da mesma busca
  da etapa 2 (até 5), com "Ver na loja" e "Criar alerta"; nada é gravado.
  O site confere webhook, descrição e foto na primeira mensagem de cada
  instância (não espera mais a coleta).

### Etapa 8 — Mini app do Telegram (ideia 10)
- [x] Página `/app/alertas` aberta dentro do Telegram (Web App): lista, gráficos e
  ajustes visuais. Login pelo `initData` do Telegram (assinatura HMAC com o token
  do bot), sem senha.
- [x] Botão de menu do bot apontando para o mini app (`setChatMenuButton`).
- Feito em 20/11/2026: lista, gráfico 30/90/365, ajustes (menor, valor,
  queda, estoque, prazo, apagar) e resumo semanal; "📱 Abrir painel" em Meus
  alertas. Só /app/ aceita ser aberta pelo Telegram Web (frame-ancestors).

### Etapa 9 — Indicação (ideia 12)
- [x] Link próprio de cada pessoa (`?start=r_<código>`); quem trouxer amigos
  ganha mais vagas (ex.: +5 por amigo que criar um alerta, até 30).
- Feito em 20/11/2026 (migração 0030): código aleatório de 8 letras; só gente
  nova (sem alerta) entra por indicação; conta no 1º alerta, uma vez; aviso a
  quem indicou sem dizer quem foi; `ALERTA_BONUS_POR_AMIGO` (5) e
  `ALERTA_MAX_COM_BONUS` (30); /convidar e botão em Meus alertas.

### Etapa 10 — Grupos (ideia 14)
- [x] Bot em grupos (família/amigos): lista de desejos compartilhada, avisos no
  grupo, só admins do grupo mudam os alertas.
- Feito em 20/11/2026: qualquer membro adiciona (/alerta link, /buscar); só
  admins apagam, ajustam e usam /parar (getChatMember a cada mudança); limite
  de 20 por grupo; sem resumo, convite nem mini app; sair do grupo apaga a
  lista; supergrupo leva a lista junto.

### Etapa 11 — Premium (ideia 13) — por último
- [ ] Mais alertas e leitura a cada 30 min. Pagamento por **Telegram Stars**.
- Só faz sentido com usuários e custo de API reais; decisões de preço e termos
  são da pessoa dona do canal.

## Regras que valem em todas as etapas
- Preço só por API oficial (sem scraping); a única leitura de página é a do link
  "compartilhar" do Mercado Livre para achar o produto.
- Todo link de produto com o código de afiliado (ML `matt_word=canaltabarato`,
  `matt_tool=71195511`; Shopee subId `alerta`; Amazon `canaltb-*`).
- Guardar só o `chat_id`; `/parar` apaga tudo; quem bloqueia o bot é apagado.
- Migração do D1, push e deploy do Worker só com OK explícito a cada vez.
