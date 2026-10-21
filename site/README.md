# Site Tá Barato

Vitrine mobile-first hospedada gratuitamente no Cloudflare Pages. As ofertas são
enviadas pelo bot para `POST /api/publish`, protegidas pelo segredo `PUBLISH_TOKEN`.
Os botões passam por `/go/:id`, que registra o clique e encaminha ao link oficial
de afiliado.

Cada oferta publicada passa a fazer parte de um catálogo persistente. O bot
revalida gradualmente preço, desconto, nota, vendas e disponibilidade pelas APIs
oficiais dentro das rodadas que já existem, sem criar novas execuções nem
republicar o produto no Telegram ou Bluesky. Itens recentes são revistos primeiro
e produtos clicados recebem prioridade. Uma falha da API apenas adia a consulta;
o produto só sai da vitrine depois de três consultas válidas sem resultado.

O catálogo permite buscar pelo nome e combinar filtros de plataforma, categoria,
faixa de preço, nota, loja, período e presença de cupom. A API usa paginação e
informa o total real de resultados; a vitrine carrega 24 itens por vez. Termos
separados por espaço podem aparecer em posições diferentes do título. Quando não
há resultado, a página oferece um botão para limpar os filtros e um caminho para
os guias de compra. Os
atalhos destacam ofertas em alta, recentes, com
maior desconto, mais vendidas ou mais baratas. O modo “Em alta” pondera cliques
recentes, vendas, desconto, avaliação e recência. Categorias e lojas são extraídas
automaticamente das ofertas recebidas e ganham páginas permanentes.
Os filtros de plataforma são criados a partir do catálogo. Antes deles, a faixa
“Ir para a loja” mostra somente plataformas ativas cujo link para a página
principal foi convertido com sucesso pelo programa de afiliados. O bot renova
esses atalhos diariamente; Amazon e futuras integrações não aparecem antes de
estarem realmente configuradas. Os cliques passam por `/loja/:slug` e entram no
relatório agregado por plataforma.

Cupons e vouchers oficiais ficam em `/cupons`, com código quando existir,
condição, validade e link rastreado. A coleta acontece no bot pelas APIs das
plataformas e não depende de raspar páginas. Eles são publicados pelo bot assim
que forem encontrados e deixam de aparecer automaticamente após o vencimento.
Como complemento, a página consulta a API pública do CupomDesconto com cache de
uma hora. Só aceita códigos verificados, atualizados nos últimos três dias, sem
indicação de outro país e de lojas que já possuem nosso link afiliado. O link de
afiliado da fonte externa nunca é usado; a atribuição exigida aparece no cartão.
Clicar no código copia o texto e abre nosso redirecionamento para a loja em nova aba.

## Descoberta e indexação

O site publica metadados canônicos, Open Graph, dados estruturados Schema.org,
`robots.txt`, `llms.txt` e um `sitemap.xml` atualizado diretamente do banco. Cada
oferta disponível no catálogo possui uma página HTML própria em
`/oferta/:titulo--:id`, mantendo compatibilidade com os endereços antigos, que
pode ser lida mesmo por buscadores que não executam o JavaScript do catálogo.
Páginas de ofertas com menos de sete dias de preços observados, ou sem
disponibilidade confirmada, continuam acessíveis para visitantes e com o botão
de compra, mas recebem `noindex` e não entram no sitemap. Depois de sete dias
observados nos últimos 30 dias, voltam a ser elegíveis à indexação.
Páginas de lojas e categorias com menos de três produtos disponíveis seguem a
mesma regra: funcionam para visitantes, mas ficam fora dos resultados de busca
e do sitemap até formarem uma coleção útil.
Os botões de compra continuam apontando diretamente para `/go/:id` para não
adicionar uma etapa à conversão.
As páginas de produto exibem histórico dos preços observados, ofertas relacionadas,
favoritos locais, compartilhamento e um aviso de preço alterado. Relatos sinalizam
o item para revisão, mas não retiram ofertas automaticamente. O servidor limita e
deduplica relatos, visualizações e cliques com identificadores HMAC temporários; IP
e User-Agent nunca são gravados em claro. O site não exige cadastro nem envia os
favoritos ao servidor.
Ao receber uma oferta, a API também avisa o IndexNow em segundo plano. Uma falha
nesse aviso não interrompe a publicação nem expõe dados da oferta ou credenciais.

## Implantação

1. Criar um projeto Pages chamado `canaltabarato`.
2. Criar um banco D1 chamado `canaltabarato-ofertas` e executar `schema.sql`. Em
   instalações já existentes, executar em ordem os arquivos de `migrations/`.

O catálogo também publica páginas fixas de descoberta (`/quedas-de-preco`,
`/menores-precos`, `/mais-acessadas`, `/mais-vendidos` e faixas de preço). A
migração `0007_visitas_agregadas.sql` ativa contagens diárias de visualizações
sem armazenar IP ou identidade. A API `/api/stats` compara essas visualizações
com cliques de saída; esse indicador não equivale à exposição nem à taxa de clique
dos cards. A migração `0017_metricas_cliques_editoriais.sql` registra cards
visíveis e cliques de produtos nas matérias, por artigo, modelo, loja, posição e
origem. As contagens são agregadas e os destinos de afiliados continuam diretos.
O endpoint de métricas cria a tabela e o índice de forma idempotente na primeira
exposição válida, caso a migração ainda não tenha sido aplicada.
`0018_catalog_search_metrics.sql` registra apenas quantidades de buscas com e sem
resultado por origem e dispositivo. O texto pesquisado não é persistido. O painel
editorial mostra leituras, exibições e cliques por matéria e prioriza guias que
receberam leitores mas ainda têm modelos sem link afiliado.
3. Associar o binding `DB` ao projeto Pages.
4. Cadastrar `PUBLISH_TOKEN` e `ABUSE_HASH_SECRET` como segredos. O segundo deve ter
   pelo menos 32 caracteres aleatórios e ser compartilhado somente com as Functions.
   Cadastrar `ALLOWED_DESTINATION_HOSTS` como variável.
5. Configurar os bindings `FEEDBACK_RATE_LIMITER` e `METRICS_RATE_LIMITER` conforme
   `wrangler.toml.example`. A deduplicação D1 permanece ativa mesmo sem o binding,
   mas feedback falha fechado se `ABUSE_HASH_SECRET` estiver ausente.
6. Publicar `site/public` com a pasta `site/functions` no mesmo projeto.
7. No GitHub, cadastrar `SITE_API_URL=https://canaltabarato.com.br/api/publish`,
   `SITE_ATIVO=true`, `SITE_REFRESH_PER_RUN=6` e `SITE_API_TOKEN` como segredo.

## Blog e painel editorial

O blog público fica em `/blog` e cada matéria em `/blog/:slug`. As pautas nascem
de dúvidas de busca e não do catálogo de promoções. Cada artigo pode cadastrar até
12 produtos editoriais independentes, com ficha técnica e URL afiliada própria,
além de opcionalmente relacionar itens do catálogo. Use `{{product:ID}}` para um
card e `{{editorial-comparison-table}}` para a tabela. O conteúdo aceita subtítulos
com `##`, negrito com `**texto**` e listas iniciadas por `-`; HTML arbitrário não
é aceito.

O painel também oferece uma coleção editorial inicial com dez guias originais
sobre escolha de celulares. A publicação é idempotente, registra a migração em
`site_migrations` e não cria duplicatas. Cada guia inclui fontes de fabricantes,
links internos para o mesmo núcleo temático e não depende de ofertas ou afiliados.
O script do AdSense é carregado somente nas páginas de matéria; catálogo e páginas
institucionais mantêm apenas a identificação da conta por metatag. Na tela de
verificação de propriedade do AdSense, use a opção "Metatag"; a opção de script
não corresponde à configuração deliberada das demais páginas. A aprovação do
site depende de análise editorial do Google e não é garantida pelo código.

Na lista de matérias, o painel sinaliza modelos publicados sem link de afiliado,
preço de referência, ficha técnica ou imagem. Esses alertas são uma lista de revisão
editorial; não substituem a conferência da variante, da fonte e da validade dos
links e preços antes de manter uma recomendação publicada.

Execute as migrações `0013_blog.sql`, `0014_blog_produtos_editoriais.sql`,
`0015_blog_multiplos_links.sql`, `0016_blog_preco_consultado.sql` e
`0017_metricas_cliques_editoriais.sql` e `0018_catalog_search_metrics.sql` antes
de usar o painel. A API administrativa também cria a nova tabela de forma
idempotente. Proteja `/admin*` e
`/api/admin/*` com um aplicativo self-hosted do Cloudflare Access. Configure
`ADMIN_EMAILS`, `CF_ACCESS_TEAM_DOMAIN` e `CF_ACCESS_AUD` no Pages. O servidor
valida a assinatura, emissor, audiência, validade e e-mail do JWT do Access; sem
essas variáveis o painel falha fechado. O painel não possui senha própria.

## Direct automático do Instagram

O endpoint `https://canaltabarato.com.br/api/meta-webhook` recebe respostas a
Stories. Uma resposta com qualquer conteúdo usa a oferta associada ao Story; uma
mensagem comum contendo a palavra `QUERO` usa a oferta do Story mais recente.

No ambiente de produção do Pages, cadastre como segredos `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN` e `META_PAGE_ACCESS_TOKEN`. Cadastre como variáveis
`META_PAGE_ID`, `META_INSTAGRAM_ACCOUNT_ID` e `META_GRAPH_API_VERSION=v26.0`.
O valor de `META_WEBHOOK_VERIFY_TOKEN` deve ser exatamente o mesmo informado ao
configurar o webhook na Meta.
O endpoint de verificação falha fechado quando qualquer um desses valores está ausente.

No aplicativo da Meta, conceda `instagram_manage_messages`,
`pages_manage_metadata` e, quando exigido pela assinatura da Página,
`pages_messaging`; configure o callback acima e assine o campo `messages`
do Instagram. O token da Página precisa ter sido emitido novamente com essas
permissões. Para responder ao público fora dos usuários administradores/testadores,
o aplicativo e as permissões precisam do nível de acesso exigido pela Meta.
Use `https://canaltabarato.com.br/privacidade` como URL da Política de
Privacidade, `https://canaltabarato.com.br/termos` como Termos de Serviço e
`https://canaltabarato.com.br/exclusao-de-dados` como URL das instruções de
exclusão de dados na configuração básica do aplicativo.

Somente depois de concluir e testar essa configuração, defina a variável do
GitHub `INSTAGRAM_DIRECT_ATIVO=true`. Enquanto ela estiver falsa, o cartão mantém
o link em texto e não promete uma resposta automática.

## Alertas por palavra-chave (bot público do Telegram)

Bot separado do painel administrativo. Quem conversa com ele cadastra até 5
palavras e recebe no privado as ofertas publicadas no site cujo título contém
a palavra (no máximo 6 avisos por dia, um por oferta). Guarda apenas o chat_id
numérico e as palavras; `/parar` ou bloquear o bot apaga tudo.

Ativação:

1. Crie o bot no @BotFather e guarde o token e o nome de usuário.
   Em seguida rode `python3 scripts/configurar_bot_alertas.py`: ele configura
   comandos, descrição e webhook, gera o segredo e lista o que cadastrar abaixo
   (os passos 2 e 4 ficam resolvidos por ele, menos o cadastro no Cloudflare).
2. No projeto Pages `canaltabarato`, configure:
   - secret `TELEGRAM_ALERTS_BOT_TOKEN`: token do bot;
   - secret `TELEGRAM_ALERTS_WEBHOOK_SECRET`: 32+ caracteres aleatórios
     (somente letras, números, `_` e `-`);
   - variável `TELEGRAM_ALERTS_BOT_USERNAME`: nome do bot sem `@`
     (mostra o convite de alerta na página de oferta).
3. Aplique `migrations/0019_alertas_telegram.sql` ao D1 (as tabelas também
   são criadas sob demanda).
4. Publique o site e registre o webhook, trocando os valores:

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://canaltabarato.com.br/api/telegram-alerts \
     -d secret_token=<SEGREDO> \
     -d 'allowed_updates=["message"]'
   ```

Sem o token e o segredo o endpoint responde 503 e nenhum alerta é enviado.
