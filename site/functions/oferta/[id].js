const SITE='https://canaltabarato.pages.dev';

function html(value='') {
  return String(value).replace(/[&<>'\"]/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
}

function money(value) {
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
}

function compact(value) {
  return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(Number(value)||0);
}

function shorten(value,limit) {
  const text=String(value||'').replace(/\s+/g,' ').trim();
  if(text.length<=limit) return text;
  const cut=text.slice(0,limit-1);
  return `${cut.slice(0,Math.max(cut.lastIndexOf(' '),limit-18)).trim()}…`;
}

function documentResponse(body,status=200) {
  return new Response(body,{status,headers:{
    'Content-Type':'text/html; charset=utf-8',
    'Cache-Control':status===200?'public, max-age=300, stale-while-revalidate=1800':'no-store',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'X-Content-Type-Options':'nosniff',
    'X-Robots-Tag':status===200?'index, follow, max-image-preview:large':'noindex, nofollow'
  }});
}

function notFound() {
  return documentResponse(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Oferta não encontrada | Tá Barato</title><link rel="stylesheet" href="/styles.css"></head><body><main class="not-found"><p class="eyebrow">TÁ BARATO</p><h1>Esta oferta não está disponível.</h1><p>Ela pode ter saído do catálogo ou o endereço está incorreto.</p><a class="buy" href="/">Ver ofertas recentes</a></main></body></html>`,404);
}

export async function onRequestGet({params,env}) {
  const id=String(params.id||'');
  if(!id||id.length>160) return notFound();
  const since=Math.floor(Date.now()/1000)-30*86400;
  const offer=await env.DB.prepare(
    'SELECT id,title,price,original_price,discount,rating,sales,shop,image_url,source,category,published_at FROM offers WHERE id=? AND published_at>=?'
  ).bind(id,since).first();
  if(!offer) return notFound();

  const canonical=`${SITE}/oferta/${encodeURIComponent(offer.id)}`;
  const productName=shorten(offer.title,180);
  const sourceName=shorten(offer.source||'loja parceira',30);
  const title=shorten(`${productName} por ${money(offer.price)} | Tá Barato`,65);
  const description=shorten(`${productName} por ${money(offer.price)}${offer.discount?` com ${Math.round(offer.discount)}% de desconto`:''} na ${sourceName}. Confira preço e condições.`,155);
  const published=new Date(Number(offer.published_at)*1000);
  const publishedText=published.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
  const product={
    '@context':'https://schema.org',
    '@type':'Product',
    name:productName,
    image:[String(offer.image_url)],
    description,
    url:canonical,
    offers:{
      '@type':'Offer',
      url:`${SITE}/go/${encodeURIComponent(offer.id)}`,
      priceCurrency:'BRL',
      price:Number(offer.price),
      seller:{'@type':'Organization',name:String(offer.shop||offer.source)}
    }
  };
  const structured=JSON.stringify(product).replace(/</g,'\\u003c');
  const oldPrice=offer.original_price?`<span class="was">${html(money(offer.original_price))}</span>`:'';
  const rating=offer.rating?`⭐ ${Number(offer.rating).toFixed(1)}`:'';
  const sales=offer.sales?`${rating?' · ':''}${html(compact(offer.sales))} vendidos`:'';
  const shop=offer.shop?`<p class="offer-shop">Loja: <strong>${html(offer.shop)}</strong></p>`:'';

  return documentResponse(`<!doctype html>
<html lang="pt-BR"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${html(title)}</title>
  <meta name="description" content="${html(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${html(canonical)}">
  <meta property="og:type" content="product"><meta property="og:locale" content="pt_BR"><meta property="og:site_name" content="Tá Barato">
  <meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(description)}"><meta property="og:url" content="${html(canonical)}">
  <meta name="twitter:card" content="summary"><meta name="twitter:title" content="${html(title)}"><meta name="twitter:description" content="${html(description)}">
  <meta name="theme-color" content="#ff5a1f"><link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">${structured}</script>
</head><body>
  <header class="topbar"><a class="brand" href="/" aria-label="Tá Barato — início"><img class="brand-mark" src="https://t.me/i/userpic/320/CanalTaBarato.jpg" alt=""><span>TÁ <strong>BARATO</strong></span></a><a class="telegram-link" href="https://t.me/CanalTaBarato" rel="noopener noreferrer">Canal no Telegram <span>↗</span></a></header>
  <main class="offer-page"><a class="offer-back" href="/">← Voltar para as ofertas</a>
    <article class="offer-detail">
      <div class="offer-detail-media">${offer.discount?`<span class="discount">−${Math.round(Number(offer.discount))}%</span>`:''}<img src="${html(offer.image_url)}" alt="${html(offer.title)}"></div>
      <div class="offer-detail-body"><span class="source">${html(offer.source)}${offer.category?` · ${html(offer.category)}`:''}</span><h1>${html(offer.title)}</h1>
        <div class="offer-detail-price"><span class="price">${html(money(offer.price))}</span>${oldPrice}</div>
        ${rating||sales?`<p class="meta">${rating}${sales}</p>`:''}${shop}
        <a class="buy" href="/go/${encodeURIComponent(offer.id)}" rel="nofollow sponsored">Ver oferta no site oficial ↗</a>
        <p class="offer-detail-note">O preço e a disponibilidade podem mudar sem aviso. Este pode ser um link de afiliado, sem custo adicional para você.</p>
        <p class="offer-date">Oferta publicada em ${html(publishedText)}</p>
      </div>
    </article>
  </main>
  <footer><div class="brand footer-brand"><img class="brand-mark" src="https://t.me/i/userpic/320/CanalTaBarato.jpg" alt=""><span>TÁ <strong>BARATO</strong></span></div><p>Compare as condições no site oficial antes de concluir a compra.</p><small>© ${new Date().getFullYear()} Tá Barato</small></footer>
</body></html>`);
}
