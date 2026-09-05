# Site Tá Barato

Vitrine mobile-first hospedada gratuitamente no Cloudflare Pages. As ofertas são
enviadas pelo bot para `POST /api/publish`, protegidas pelo segredo `PUBLISH_TOKEN`.
Os botões passam por `/go/:id`, que registra o clique e encaminha ao link oficial
de afiliado.

O catálogo permite buscar pelo nome e combinar filtros de plataforma, categoria,
faixa de preço, nota e loja. A ordenação pode priorizar ofertas recentes, maior
desconto, preço, avaliação ou volume de vendas. Categorias e lojas são extraídas
automaticamente das ofertas recebidas.
Os botões de plataforma também são criados a partir do catálogo: uma loja só
aparece como filtro depois que sua primeira oferta é publicada.

## Implantação

1. Criar um projeto Pages chamado `canaltabarato`.
2. Criar um banco D1 chamado `canaltabarato-ofertas` e executar `schema.sql`.
3. Associar o binding `DB` ao projeto Pages.
4. Cadastrar `PUBLISH_TOKEN` como segredo e `ALLOWED_DESTINATION_HOSTS` como variável.
5. Publicar `site/public` com a pasta `site/functions` no mesmo projeto.
6. No GitHub, cadastrar `SITE_API_URL=https://canaltabarato.pages.dev/api/publish`,
   `SITE_ATIVO=true` e `SITE_API_TOKEN` como segredo.
