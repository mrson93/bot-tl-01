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
informa o total real de resultados; a vitrine carrega 24 itens por vez. Os
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
Os botões de compra continuam apontando diretamente para `/go/:id` para não
adicionar uma etapa à conversão.
As páginas de produto exibem histórico dos preços observados, ofertas relacionadas,
favoritos locais, compartilhamento e um aviso de preço alterado. Cinco relatos
retiram o item da vitrine; o formulário aceita apenas requisições do próprio site
e o navegador impede relatos repetidos comuns. O site não exige cadastro nem envia
os favoritos ao servidor.
Ao receber uma oferta, a API também avisa o IndexNow em segundo plano. Uma falha
nesse aviso não interrompe a publicação nem expõe dados da oferta ou credenciais.

## Implantação

1. Criar um projeto Pages chamado `canaltabarato`.
2. Criar um banco D1 chamado `canaltabarato-ofertas` e executar `schema.sql`. Em
   instalações já existentes, executar em ordem os arquivos de `migrations/`.

O catálogo também publica páginas fixas de descoberta (`/quedas-de-preco`,
`/menores-precos`, `/mais-acessadas`, `/mais-vendidos` e faixas de preço). A
migração `0007_visitas_agregadas.sql` ativa contagens diárias de visualizações
sem armazenar IP, identidade ou cookies de publicidade; o relatório privado
compara essas visualizações com os cliques de saída para as lojas.
3. Associar o binding `DB` ao projeto Pages.
4. Cadastrar `PUBLISH_TOKEN` como segredo e `ALLOWED_DESTINATION_HOSTS` como variável.
5. Publicar `site/public` com a pasta `site/functions` no mesmo projeto.
6. No GitHub, cadastrar `SITE_API_URL=https://canaltabarato.pages.dev/api/publish`,
   `SITE_ATIVO=true`, `SITE_REFRESH_PER_RUN=6` e `SITE_API_TOKEN` como segredo.

## Direct automático do Instagram

O endpoint `https://canaltabarato.pages.dev/api/meta-webhook` recebe respostas a
Stories. Uma resposta com qualquer conteúdo usa a oferta associada ao Story; uma
mensagem comum contendo a palavra `QUERO` usa a oferta do Story mais recente.

No ambiente de produção do Pages, cadastre como segredos `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN` e `META_PAGE_ACCESS_TOKEN`. Cadastre como variáveis
`META_PAGE_ID`, `META_INSTAGRAM_ACCOUNT_ID` e `META_GRAPH_API_VERSION=v26.0`.
O valor de `META_WEBHOOK_VERIFY_TOKEN` deve ser exatamente o mesmo informado ao
configurar o webhook na Meta.

No aplicativo da Meta, conceda `instagram_manage_messages`,
`pages_manage_metadata` e, quando exigido pela assinatura da Página,
`pages_messaging`; configure o callback acima e assine o campo `messages`
do Instagram. O token da Página precisa ter sido emitido novamente com essas
permissões. Para responder ao público fora dos usuários administradores/testadores,
o aplicativo e as permissões precisam do nível de acesso exigido pela Meta.
Use `https://canaltabarato.pages.dev/privacidade` como URL da Política de
Privacidade e `https://canaltabarato.pages.dev/exclusao-de-dados` como URL das
instruções de exclusão de dados na configuração básica do aplicativo.

Somente depois de concluir e testar essa configuração, defina a variável do
GitHub `INSTAGRAM_DIRECT_ATIVO=true`. Enquanto ela estiver falsa, o cartão mantém
o link em texto e não promete uma resposta automática.
