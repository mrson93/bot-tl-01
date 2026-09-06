# Site Tá Barato

Vitrine mobile-first hospedada gratuitamente no Cloudflare Pages. As ofertas são
enviadas pelo bot para `POST /api/publish`, protegidas pelo segredo `PUBLISH_TOKEN`.
Os botões passam por `/go/:id`, que registra o clique e encaminha ao link oficial
de afiliado.

O catálogo permite buscar pelo nome e combinar filtros de plataforma, categoria,
faixa de preço, nota e loja. Os atalhos destacam ofertas em alta, recentes, com
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
oferta dos últimos 30 dias possui uma página HTML própria em
`/oferta/:titulo--:id`, mantendo compatibilidade com os endereços antigos, que
pode ser lida mesmo por buscadores que não executam o JavaScript do catálogo.
Os botões de compra continuam apontando diretamente para `/go/:id` para não
adicionar uma etapa à conversão.
Ao receber uma oferta, a API também avisa o IndexNow em segundo plano. Uma falha
nesse aviso não interrompe a publicação nem expõe dados da oferta ou credenciais.

## Implantação

1. Criar um projeto Pages chamado `canaltabarato`.
2. Criar um banco D1 chamado `canaltabarato-ofertas` e executar `schema.sql`. Em
   instalações já existentes, executar em ordem os arquivos de `migrations/`.
3. Associar o binding `DB` ao projeto Pages.
4. Cadastrar `PUBLISH_TOKEN` como segredo e `ALLOWED_DESTINATION_HOSTS` como variável.
5. Publicar `site/public` com a pasta `site/functions` no mesmo projeto.
6. No GitHub, cadastrar `SITE_API_URL=https://canaltabarato.pages.dev/api/publish`,
   `SITE_ATIVO=true` e `SITE_API_TOKEN` como segredo.
