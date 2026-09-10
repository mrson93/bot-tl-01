import {SITE,footer,head,header,html,offerCard,offerPath,responseHtml,shorten} from './_site.js';

const OFFER_COLUMNS=`o.id,o.title,o.price,o.original_price,o.discount,o.rating,o.sales,
  o.shop,o.image_url,o.source,o.category,o.published_at,o.cataloged_at,o.last_checked_at,
  o.availability,o.price_changed_at,o.coupon_code,o.coupon_condition,o.coupon_expires_at,o.payment_label`;

const PAGES={
  drops:{slug:'quedas-de-preco',eyebrow:'PREÇO EM MOVIMENTO',title:'Quedas de preço recentes',
    description:'Produtos cujo preço atual caiu em relação ao valor observado anteriormente no Tá Barato.',
    empty:'Ainda não registramos uma queda recente. Continue acompanhando: os preços são revistos automaticamente.'},
  lows:{slug:'menores-precos',eyebrow:'HISTÓRICO DO CATÁLOGO',title:'Menores preços observados',
    description:'Ofertas no menor valor que já registramos nos últimos 30 dias. O período acompanhado aparece em cada produto.',
    empty:'Nenhum produto está no menor preço observado neste momento.'},
  popular:{slug:'mais-acessadas',eyebrow:'INTERESSE DOS VISITANTES',title:'Ofertas mais acessadas',
    description:'Produtos que mais receberam cliques de saída para as lojas nos últimos sete dias.',
    empty:'Ainda não há cliques suficientes para formar esta lista.'},
  sellers:{slug:'mais-vendidos',eyebrow:'POPULARIDADE NAS LOJAS',title:'Produtos mais vendidos',
    description:'Itens com maior quantidade de vendas informada pelas plataformas, com o preço mais recente do nosso catálogo.',
    empty:'As plataformas ainda não informaram vendas para os produtos disponíveis.'},
};

function baseQuery() {
  return `SELECT ${OFFER_COLUMNS},COALESCE(p.observations,0) observations,p.min_price,p.avg_price,
    COALESCE(c.clicks_7d,0) clicks_7d,
    (SELECT previous.price FROM offer_prices previous WHERE previous.offer_id=o.id
      AND previous.observed_at<COALESCE(o.price_changed_at,0)
      ORDER BY previous.observed_at DESC LIMIT 1) previous_price
    FROM offers o
    LEFT JOIN (SELECT offer_id,COUNT(*) observations,MIN(price) min_price,AVG(price) avg_price
      FROM offer_prices WHERE observed_at>=? GROUP BY offer_id) p ON p.offer_id=o.id
    LEFT JOIN (SELECT offer_id,COUNT(*) clicks_7d FROM clicks WHERE clicked_at>=? GROUP BY offer_id) c ON c.offer_id=o.id
    WHERE o.availability!='unavailable'
      AND NOT EXISTS (SELECT 1 FROM offer_feedback f WHERE f.offer_id=o.id AND f.kind='expired' AND f.quantity>=5)`;
}

function decorate(row,kind) {
  const observations=Number(row.observations)||0;
  if(kind==='drops') {
    const drop=((Number(row.previous_price)-Number(row.price))/Number(row.previous_price))*100;
    row.insight_label=`Caiu ${drop.toLocaleString('pt-BR',{maximumFractionDigits:1})}% desde a medição anterior`;
  } else if(kind==='lows') row.insight_label=`Menor preço em ${observations} ${observations===1?'dia':'dias'} acompanhados`;
  else if(kind==='popular') row.insight_label=`${Number(row.clicks_7d)} ${Number(row.clicks_7d)===1?'acesso':'acessos'} à loja em 7 dias`;
  else if(kind==='sellers') row.insight_label='Entre os mais vendidos do catálogo';
  return row;
}

export async function discoveryPage(env,kind) {
  const page=PAGES[kind];
  if(!page) return new Response('Not found',{status:404});
  const now=Math.floor(Date.now()/1000),since30d=now-30*86400,since7d=now-7*86400;
  let sql=`SELECT * FROM (${baseQuery()}) ranked`,bindings=[since30d,since7d];
  if(kind==='drops') {sql+=' WHERE previous_price IS NOT NULL AND previous_price>price AND price_changed_at>=? ORDER BY ((previous_price-price)/previous_price) DESC,price_changed_at DESC';bindings.push(since7d);}
  if(kind==='lows') sql+=' WHERE observations>=2 AND price<=min_price+0.005 ORDER BY observations DESC,discount DESC';
  if(kind==='popular') sql+=' WHERE clicks_7d>0 ORDER BY clicks_7d DESC,discount DESC';
  if(kind==='sellers') sql+=' WHERE sales>0 ORDER BY sales DESC,discount DESC';
  sql+=' LIMIT 100';
  const result=await env.DB.prepare(sql).bind(...bindings).all();
  const rows=(result.results||[]).map(row=>decorate(row,kind));
  const canonical=`${SITE}/${page.slug}`,description=shorten(page.description,155);
  const structured=JSON.stringify({'@context':'https://schema.org','@type':'CollectionPage',name:page.title,
    description,url:canonical,mainEntity:{'@type':'ItemList',itemListElement:rows.map((offer,index)=>({
      '@type':'ListItem',position:index+1,url:`${SITE}${offerPath(offer)}`}))}}).replace(/</g,'\\u003c');
  const grid=rows.length?`<div class="offer-grid collection-grid">${rows.map(offerCard).join('')}</div>`:
    `<div class="empty"><h2>Lista em formação</h2><p>${html(page.empty)}</p></div>`;
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title:`${page.title} | Tá Barato`,description,canonical,structured})}</head><body>${header('history')}<main class="collection-page"><a class="offer-back" href="/">← Todo o catálogo</a><div class="collection-heading"><p class="eyebrow">${html(page.eyebrow)}</p><h1>${html(page.title)}</h1><p>${html(page.description)}</p><strong>${rows.length} ${rows.length===1?'produto':'produtos'}</strong></div><nav class="insight-tabs" aria-label="Explorar histórico"><a href="/quedas-de-preco"${kind==='drops'?' aria-current="page"':''}>Quedas</a><a href="/menores-precos"${kind==='lows'?' aria-current="page"':''}>Menores preços</a><a href="/mais-acessadas"${kind==='popular'?' aria-current="page"':''}>Mais acessadas</a><a href="/mais-vendidos"${kind==='sellers'?' aria-current="page"':''}>Mais vendidos</a></nav>${grid}</main>${footer()}</body></html>`);
}

const PRICE_RANGES={
  'ate-50':{title:'Ofertas até R$ 50',description:'Produtos de até R$ 50 com preço atualizado e link direto para a loja.',where:'price<=?',values:[50]},
  'de-50-a-100':{title:'Ofertas de R$ 50 a R$ 100',description:'Produtos entre R$ 50 e R$ 100 para comparar preço, desconto e popularidade.',where:'price>? AND price<=?',values:[50,100]},
  'de-100-a-200':{title:'Ofertas de R$ 100 a R$ 200',description:'Produtos entre R$ 100 e R$ 200 com valores acompanhados pelo Tá Barato.',where:'price>? AND price<=?',values:[100,200]},
  'acima-de-200':{title:'Ofertas acima de R$ 200',description:'Produtos acima de R$ 200 com preço recente, avaliação e histórico disponível.',where:'price>?',values:[200]},
};

export async function priceRangePage(env,slug) {
  const range=PRICE_RANGES[slug];
  if(!range) return new Response('Not found',{status:404});
  const now=Math.floor(Date.now()/1000);
  const result=await env.DB.prepare(`SELECT * FROM (${baseQuery()}) ranked WHERE ${range.where} ORDER BY discount DESC,COALESCE(last_checked_at,published_at) DESC LIMIT 100`)
    .bind(now-30*86400,now-7*86400,...range.values).all();
  const rows=result.results||[],canonical=`${SITE}/faixas-de-preco/${slug}`;
  const structured=JSON.stringify({'@context':'https://schema.org','@type':'CollectionPage',name:range.title,
    description:range.description,url:canonical,mainEntity:{'@type':'ItemList',itemListElement:rows.map((offer,index)=>({
      '@type':'ListItem',position:index+1,url:`${SITE}${offerPath(offer)}`}))}}).replace(/</g,'\\u003c');
  const grid=rows.length?`<div class="offer-grid collection-grid">${rows.map(offerCard).join('')}</div>`:
    '<div class="empty"><h2>Nenhum produto disponível</h2><p>Volte em breve para conferir novos achados.</p></div>';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title:`${range.title} | Tá Barato`,description:range.description,canonical,structured})}</head><body>${header()}<main class="collection-page"><a class="offer-back" href="/">← Todo o catálogo</a><div class="collection-heading"><p class="eyebrow">COMPRE POR FAIXA</p><h1>${html(range.title)}</h1><p>${html(range.description)}</p><strong>${rows.length} ${rows.length===1?'produto':'produtos'}</strong></div><nav class="insight-tabs" aria-label="Faixas de preço">${Object.entries(PRICE_RANGES).map(([key,item])=>`<a href="/faixas-de-preco/${key}"${key===slug?' aria-current="page"':''}>${html(item.title.replace('Ofertas ',''))}</a>`).join('')}</nav>${grid}</main>${footer()}</body></html>`);
}
