export const SITE='https://canaltabarato.com.br';
const CLOUDFLARE_ANALYTICS=`<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"b38a565601354278a8c4050fbda67923"}'></script>`;
const GOOGLE_ANALYTICS='<script src="/google-analytics.js" defer></script>';

export function html(value='') {
  return String(value).replace(/[&<>'\"]/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
  }[char]));
}

export function xml(value='') {
  return String(value).replace(/[<>&'\"]/g,char=>({
    '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'
  }[char]));
}

export function money(value) {
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
}

export function compact(value) {
  return new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(Number(value)||0);
}

export function shorten(value,limit) {
  const text=String(value||'').replace(/\s+/g,' ').trim();
  if(text.length<=limit) return text;
  const cut=text.slice(0,limit-1);
  return `${cut.slice(0,Math.max(cut.lastIndexOf(' '),limit-18)).trim()}…`;
}

export function slugify(value) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'oferta';
}

export function normalizeCategory(value='') {
  const key=slugify(value);
  if(/infantil|bebe|crianca|brinquedo/.test(key)) return 'infantil';
  if(/livr/.test(key)) return 'livros'; if(/\bpet\b/.test(key)) return 'pet';
  if(/cozinha/.test(key)) return 'cozinha'; if(/ferrament|industrial/.test(key)) return 'ferramentas';
  if(/automot|carro/.test(key)) return 'automotivo'; if(/esport|fitness|academia|creatina|whey|suplement/.test(key)) return 'esportes';
  if(/sapato|moda|roupa|vestuario/.test(key)) return 'moda'; if(/eletron|tecnolog|informat/.test(key)) return 'eletronicos';
  if(/beleza|saude|cosmetic/.test(key)) return 'beleza'; if(/casa|decor|moveis/.test(key)) return 'casa'; return 'outros';
}

export function label(value='') {
  const known={eletronicos:'Eletrônicos',automotivo:'Automotivo',infantil:'Infantil',ferramentas:'Ferramentas',esportes:'Esportes',cozinha:'Cozinha',casa:'Casa',moda:'Moda',beleza:'Beleza e saúde',livros:'Livros',pet:'Pet',outros:'Outros'};
  const key=slugify(value);
  if(known[key]) return known[key];
  return String(value).replace(/[_-]+/g,' ').replace(/(^|\s)(\p{L})/gu,
    (_,space,letter)=>space+letter.toLocaleUpperCase('pt-BR'));
}

export function offerPath(offer) {
  return `/oferta/${slugify(offer.title)}--${encodeURIComponent(offer.id)}`;
}

export function offerIdFromPath(value='') {
  const raw=String(value);
  const separator=raw.lastIndexOf('--');
  const id=separator>=0?raw.slice(separator+2):raw;
  try{return decodeURIComponent(id);}catch{return id;}
}

export function ageLabel(timestamp,now=Math.floor(Date.now()/1000)) {
  const seconds=Math.max(0,now-Number(timestamp||now));
  if(seconds<3600) return `há ${Math.max(1,Math.floor(seconds/60))} min`;
  if(seconds<86400) return `há ${Math.floor(seconds/3600)} h`;
  const days=Math.floor(seconds/86400);
  return `há ${days} ${days===1?'dia':'dias'}`;
}

export function couponActive(offer,now=Math.floor(Date.now()/1000)) {
  return Boolean(offer.coupon_code)&&(!offer.coupon_expires_at||Number(offer.coupon_expires_at)>now);
}

export function responseHtml(body,status=200,cache='public, max-age=300, stale-while-revalidate=1800') {
  return new Response(body,{status,headers:{
    'Content-Type':'text/html; charset=utf-8',
    'Cache-Control':status===200?cache:'no-store',
    'Content-Security-Policy':"default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://www.googletagmanager.com; style-src 'self'; img-src 'self' https:; connect-src 'self' https://cloudflareinsights.com https://*.google-analytics.com; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'X-Content-Type-Options':'nosniff',
    'X-Robots-Tag':status===200?'index, follow, max-image-preview:large':'noindex, nofollow'
  }});
}

export function head({title,description,canonical,structured='',image=''}) {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${html(title)}</title><meta name="description" content="${html(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${html(canonical)}"><meta name="theme-color" content="#ff5a1f">
  <meta property="og:type" content="website"><meta property="og:locale" content="pt_BR"><meta property="og:site_name" content="Tá Barato">
  <meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(description)}"><meta property="og:url" content="${html(canonical)}">${image?`<meta property="og:image" content="${html(image)}">`:''}
  <meta name="twitter:card" content="${image?'summary_large_image':'summary'}"><meta name="twitter:title" content="${html(title)}"><meta name="twitter:description" content="${html(description)}">${image?`<meta name="twitter:image" content="${html(image)}">`:''}
  <link rel="stylesheet" href="/styles.css"><script src="/analytics.js" defer></script>${GOOGLE_ANALYTICS}${structured?`<script type="application/ld+json">${structured}</script>`:''}${CLOUDFLARE_ANALYTICS}`;
}

export function header(active='offers') {
  return `<header class="topbar"><a class="brand" href="/" aria-label="Tá Barato — início"><img class="brand-mark" src="https://t.me/i/userpic/320/CanalTaBarato.jpg" alt=""><span>TÁ <strong>BARATO</strong></span></a><nav class="main-nav" aria-label="Principal"><a href="/"${active==='offers'?' aria-current="page"':''}>Ofertas</a><a href="/quedas-de-preco"${active==='history'?' aria-current="page"':''}>Histórico</a><a href="/cupons"${active==='coupons'?' aria-current="page"':''}>Cupons</a></nav><a class="telegram-link" href="https://t.me/CanalTaBarato" rel="noopener noreferrer">Telegram <span>↗</span></a></header>`;
}

export function footer() {
  return `<footer><div class="brand footer-brand"><img class="brand-mark" src="https://t.me/i/userpic/320/CanalTaBarato.jpg" alt=""><span>TÁ <strong>BARATO</strong></span></div><p>Os preços podem mudar sem aviso. Os links podem gerar comissão para o canal, sem custo adicional para você.</p><nav class="footer-links"><a href="/quedas-de-preco">Quedas de preço</a><a href="/menores-precos">Menores preços</a><a href="/mais-acessadas">Mais acessadas</a><a href="/mais-vendidos">Mais vendidos</a><a href="/como-escolhemos">Como escolhemos</a><a href="/faq">Dúvidas</a><a href="/privacidade">Privacidade</a><a href="/termos">Termos</a><a href="/exclusao-de-dados">Exclusão de dados</a><a href="/contato">Contato</a></nav><small>© ${new Date().getFullYear()} Tá Barato</small></footer>`;
}

export function infoPage({slug,title,eyebrow,description,content,structured=''}) {
  const canonical=`${SITE}/${slug}`;
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title:`${title} | Tá Barato`,description,canonical,structured})}</head><body>${header()}<main class="info-page"><p class="eyebrow">${html(eyebrow)}</p><h1>${html(title)}</h1><div class="info-content">${content}</div></main>${footer()}</body></html>`,200,'public, max-age=3600, stale-while-revalidate=86400');
}

export function offerCard(offer) {
  const discount=Number(offer.discount)||0;
  const rating=offer.rating?`⭐ ${Number(offer.rating).toFixed(1)}`:'';
  const sales=offer.sales?`${rating?' · ':''}${compact(offer.sales)} vendidos`:'';
  const store=offer.shop?`<a class="store-link" href="/lojas/${slugify(offer.shop)}">${html(offer.shop)}</a>`:html(offer.source);
  const flags=[offer.payment_label,couponActive(offer)?`Cupom ${offer.coupon_code}`:''].filter(Boolean);
  const checked=offer.last_checked_at||offer.published_at;
  const status=offer.availability==='unverified'?'<span class="check-pending">Revisando disponibilidade</span>':'';
  const insight=offer.insight_label?`<p class="analysis-chip">${html(offer.insight_label)}</p>`:'';
  return `<article class="offer-card"><div class="offer-media">${discount?`<span class="discount">−${Math.round(discount)}%</span>`:''}<a class="offer-detail-link" href="${offerPath(offer)}"><img src="${html(offer.image_url)}" alt="${html(offer.title)}" loading="lazy"></a></div><div class="offer-body"><div class="card-kicker"><span class="source">${html(offer.source)}</span><time title="Preço consultado na plataforma">${html(ageLabel(checked))}</time></div>${status}${insight}<h3><a class="title-link" href="${offerPath(offer)}">${html(offer.title)}</a></h3>${flags.length?`<div class="offer-flags">${flags.map(flag=>`<span>${html(flag)}</span>`).join('')}</div>`:''}<div class="card-price"><span class="price">${html(money(offer.price))}</span>${offer.original_price?`<span class="was">${html(money(offer.original_price))}</span>`:''}</div><p class="meta">${rating}${sales}</p><p class="card-store">${store}</p><a class="buy" href="/go/${encodeURIComponent(offer.id)}" rel="nofollow sponsored">Ver oferta ↗</a></div></article>`;
}

export function notFound(title='Página não encontrada') {
  return responseHtml(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${html(title)} | Tá Barato</title><link rel="stylesheet" href="/styles.css"></head><body>${header()}<main class="not-found"><p class="eyebrow">TÁ BARATO</p><h1>${html(title)}</h1><p>Este conteúdo pode ter saído do catálogo ou o endereço está incorreto.</p><a class="buy" href="/">Ver ofertas recentes</a></main>${footer()}</body></html>`,404);
}
