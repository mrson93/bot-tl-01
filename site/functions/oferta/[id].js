import {SITE,compact,couponActive,footer,head,header,html,label,money,notFound,
  offerIdFromPath,offerPath,responseHtml,shorten,slugify} from '../_site.js';

export async function onRequestGet({params,env}) {
  const id=offerIdFromPath(params.id);
  if(!id||id.length>160) return notFound('Oferta não encontrada');
  const since=Math.floor(Date.now()/1000)-30*86400;
  const offer=await env.DB.prepare(`SELECT id,title,price,original_price,discount,
    rating,sales,shop,image_url,source,category,published_at,coupon_code,
    coupon_condition,coupon_expires_at,payment_label
    FROM offers WHERE id=? AND published_at>=?`).bind(id,since).first();
  if(!offer) return notFound('Oferta não encontrada');

  const canonical=`${SITE}${offerPath(offer)}`;
  const productName=shorten(offer.title,180);
  const sourceName=shorten(offer.source||'loja parceira',30);
  const title=shorten(`${productName} por ${money(offer.price)} | Tá Barato`,65);
  const description=shorten(`${productName} por ${money(offer.price)}${offer.discount?` com ${Math.round(offer.discount)}% de desconto`:''} na ${sourceName}. Confira preço e condições.`,155);
  const published=new Date(Number(offer.published_at)*1000);
  const publishedText=published.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
  const product={
    '@context':'https://schema.org','@type':'Product',name:productName,
    image:[String(offer.image_url)],description,url:canonical,
    offers:{'@type':'Offer',url:`${SITE}/go/${encodeURIComponent(offer.id)}`,
      priceCurrency:'BRL',price:Number(offer.price),
      seller:{'@type':'Organization',name:String(offer.shop||offer.source)}}
  };
  const structured=JSON.stringify(product).replace(/</g,'\\u003c');
  const rating=offer.rating?`⭐ ${Number(offer.rating).toFixed(1)}`:'';
  const sales=offer.sales?`${rating?' · ':''}${html(compact(offer.sales))} vendidos`:'';
  const coupon=couponActive(offer)?`<section class="coupon-inline"><span>CUPOM DISPONÍVEL</span><strong>${html(offer.coupon_code)}</strong>${offer.coupon_condition?`<p>${html(offer.coupon_condition)}</p>`:''}</section>`:'';
  const flags=[offer.payment_label].filter(Boolean).map(value=>`<span>${html(value)}</span>`).join('');

  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical,structured})}</head><body>
  ${header()}<main class="offer-page"><a class="offer-back" href="/">← Voltar para as ofertas</a>
    <article class="offer-detail"><div class="offer-detail-media">${offer.discount?`<span class="discount">−${Math.round(Number(offer.discount))}%</span>`:''}<img src="${html(offer.image_url)}" alt="${html(offer.title)}"></div>
      <div class="offer-detail-body"><span class="source">${html(offer.source)}${offer.category?` · <a href="/categorias/${slugify(offer.category)}">${html(label(offer.category))}</a>`:''}</span><h1>${html(offer.title)}</h1>${flags?`<div class="offer-flags">${flags}</div>`:''}
        <div class="offer-detail-price"><span class="price">${html(money(offer.price))}</span>${offer.original_price?`<span class="was">${html(money(offer.original_price))}</span>`:''}</div>
        ${rating||sales?`<p class="meta">${rating}${sales}</p>`:''}${coupon}${offer.shop?`<p class="offer-shop">Loja: <a href="/lojas/${slugify(offer.shop)}"><strong>${html(offer.shop)}</strong></a></p>`:''}
        <a class="buy" href="/go/${encodeURIComponent(offer.id)}" rel="nofollow sponsored">Ver oferta no site oficial ↗</a>
        <p class="offer-detail-note">O preço e a disponibilidade podem mudar sem aviso. Este pode ser um link de afiliado, sem custo adicional para você.</p><p class="offer-date">Oferta publicada em ${html(publishedText)}</p>
      </div></article></main>${footer()}</body></html>`);
}
