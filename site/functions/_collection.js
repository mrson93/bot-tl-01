import {SITE,footer,head,header,html,label,notFound,offerCard,offerPath,
  responseHtml,shorten,slugify} from './_site.js';

const CONFIG={
  category:{column:'category',plural:'categorias',heading:name=>`Ofertas de ${label(name)}`,
    description:name=>`Ofertas recentes de ${label(name)}, selecionadas por preço, desconto, avaliação e vendas.`},
  shop:{column:'shop',plural:'lojas',heading:name=>`Ofertas da loja ${name}`,
    description:name=>`Ofertas recentes da ${name}, com preço, desconto e condições para comparar.`}
};

export async function collectionPage(env,kind,requestedSlug) {
  const config=CONFIG[kind];
  if(!config) return notFound();
  const since=Math.floor(Date.now()/1000)-30*86400;
  const values=await env.DB.prepare(
    `SELECT DISTINCT ${config.column} value FROM offers WHERE published_at>=? AND ${config.column} IS NOT NULL AND TRIM(${config.column})!=''`
  ).bind(since).all();
  const selected=(values.results||[]).find(row=>slugify(row.value)===requestedSlug);
  if(!selected) return notFound(kind==='category'?'Categoria não encontrada':'Loja não encontrada');

  const clickSince=Math.floor(Date.now()/1000)-86400;
  const offers=await env.DB.prepare(`SELECT o.id,o.title,o.price,o.original_price,
    o.discount,o.rating,o.sales,o.shop,o.image_url,o.source,o.category,
    o.published_at,o.coupon_code,o.coupon_condition,o.coupon_expires_at,
    o.payment_label,COALESCE(c.quantity,0) clicks_24h FROM offers o
    LEFT JOIN (SELECT offer_id,COUNT(*) quantity FROM clicks WHERE clicked_at>=? GROUP BY offer_id) c ON c.offer_id=o.id
    WHERE o.${config.column}=? AND o.published_at>=? ORDER BY o.published_at DESC LIMIT 100`
  ).bind(clickSince,selected.value,since).all();
  const heading=config.heading(selected.value);
  const description=shorten(config.description(selected.value),155);
  const canonical=`${SITE}/${config.plural}/${slugify(selected.value)}`;
  const rows=offers.results||[];
  const structured=JSON.stringify({'@context':'https://schema.org','@type':'CollectionPage',
    name:heading,description,url:canonical,mainEntity:{'@type':'ItemList',
      itemListElement:rows.map((offer,index)=>({'@type':'ListItem',position:index+1,
        url:`${SITE}${offerPath(offer)}`}))}}).replace(/</g,'\\u003c');
  const body=rows.length?`<div class="offer-grid collection-grid">${rows.map(offerCard).join('')}</div>`:
    '<div class="empty"><h2>Nenhuma oferta recente</h2><p>Volte em breve para conferir novos achados.</p></div>';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title:`${shorten(heading,50)} | Tá Barato`,description,canonical,structured})}</head><body>${header()}
    <main class="collection-page"><a class="offer-back" href="/">← Todas as ofertas</a><div class="collection-heading"><p class="eyebrow">SELEÇÃO RECENTE</p><h1>${html(heading)}</h1><p>${html(description)}</p><strong>${rows.length} ${rows.length===1?'oferta':'ofertas'}</strong></div>${body}</main>${footer()}</body></html>`);
}
