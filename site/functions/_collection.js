import {SITE,footer,head,header,html,label,notFound,offerCard,offerPath,
  responseHtml,shorten,slugify} from './_site.js';
import {indexableCollection} from './_indexing.js';

const CONFIG={
  category:{column:'category',plural:'categorias',heading:name=>`Ofertas de ${label(name)}`,
    description:name=>`Produtos de ${label(name)} com preço revisado, desconto, avaliação e vendas para comparar.`},
  shop:{column:'shop',plural:'lojas',heading:name=>`Ofertas da loja ${name}`,
    description:name=>`Produtos da ${name} com preço atualizado, desconto e condições para comparar.`}
};

// A lista de lojas e categorias muda pouco; relê-la a cada visita lia a tabela
// inteira de ofertas. Fica guardada na memória do isolate por 10 minutos.
const VALUES_TTL_MS=10*60*1000;
const valuesMemo=new Map();

async function collectionValues(env,column) {
  const memo=valuesMemo.get(column);
  if(memo&&memo.expires>Date.now()) return memo.rows;
  const result=await env.DB.prepare(
    `SELECT DISTINCT ${column} value FROM offers WHERE availability!='unavailable' AND ${column} IS NOT NULL AND TRIM(${column})!=''`
  ).all();
  const rows=result.results||[];
  valuesMemo.set(column,{rows,expires:Date.now()+VALUES_TTL_MS});
  return rows;
}

export async function collectionPage(env,kind,requestedSlug) {
  const config=CONFIG[kind];
  if(!config) return notFound();
  const selected=(await collectionValues(env,config.column)).find(row=>slugify(row.value)===requestedSlug);
  if(!selected) return notFound(kind==='category'?'Categoria não encontrada':'Loja não encontrada');

  const clickSince=Math.floor(Date.now()/1000)-86400;
  const offers=await env.DB.prepare(`SELECT o.id,o.title,o.price,o.original_price,
    o.discount,o.rating,o.sales,o.shop,o.image_url,o.source,o.category,
    o.published_at,o.cataloged_at,o.last_checked_at,o.availability,o.coupon_code,o.coupon_condition,o.coupon_expires_at,
    o.payment_label,COALESCE(c.quantity,0) clicks_24h FROM offers o
    LEFT JOIN (SELECT offer_id,COUNT(*) quantity FROM clicks WHERE clicked_at>=? GROUP BY offer_id) c ON c.offer_id=o.id
    WHERE o.${config.column}=? AND o.availability!='unavailable' ORDER BY COALESCE(o.last_checked_at,o.published_at) DESC LIMIT 100`
  ).bind(clickSince,selected.value).all();
  const heading=config.heading(selected.value);
  const description=shorten(config.description(selected.value),155);
  const canonical=`${SITE}/${config.plural}/${slugify(selected.value)}`;
  const rows=offers.results||[];
  const indexable=indexableCollection(rows.length);
  const structured=JSON.stringify({'@context':'https://schema.org','@type':'CollectionPage',
    name:heading,description,url:canonical,mainEntity:{'@type':'ItemList',
      itemListElement:rows.map((offer,index)=>({'@type':'ListItem',position:index+1,
        url:`${SITE}${offerPath(offer)}`}))}}).replace(/</g,'\\u003c');
  const body=rows.length?`<div class="offer-grid collection-grid">${rows.map(offerCard).join('')}</div>`:
    '<div class="empty"><h2>Nenhum produto disponível</h2><p>Volte em breve para conferir novos achados.</p></div>';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title:`${shorten(heading,50)} | Tá Barato`,description,canonical,structured,indexable})}</head><body>${header()}
    <main class="collection-page"><a class="offer-back" href="/">← Todo o catálogo</a><div class="collection-heading"><p class="eyebrow">CATÁLOGO ATUALIZADO</p><h1>${html(heading)}</h1><p>${html(description)}</p><strong>${rows.length} ${rows.length===1?'produto':'produtos'}</strong></div>${body}</main>${footer()}</body></html>`,200,undefined,indexable);
}
