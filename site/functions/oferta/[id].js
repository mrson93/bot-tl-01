import {SITE,compact,couponActive,footer,head,header,html,label,money,notFound,offerCard,offerIdFromPath,offerPath,productStructuredData,responseHead,responseHtml,shorten,slugify} from '../_site.js';
import {indexableOffer} from '../_indexing.js';
import {DIAS_SELO} from '../api/offers.js';
import {graficoComAbas,linhaResumo,regua,resumoPreco} from '../_price_sheet.js';
import {outrasLojasNoCatalogo} from '../_compare_stores.js';

export async function onRequestGet({params,env}) {
  const id=offerIdFromPath(params.id);
  if(!id||id.length>160) return notFound('Oferta não encontrada');
  const offer=await env.DB.prepare('SELECT id,title,price,original_price,discount,rating,sales,shop,image_url,source,category,published_at,cataloged_at,last_checked_at,last_seen_at,availability,price_changed_at,coupon_code,coupon_condition,coupon_expires_at,payment_label FROM offers WHERE id=?').bind(id).first();
  if(!offer) return notFound('Oferta não encontrada');
  const relatedValues=[id]; let relatedFilter='';
  if(offer.category){relatedFilter=' AND category=?';relatedValues.push(offer.category);}
  const since30d=Math.floor(Date.now()/1000)-30*86400;
  const [pricesResult,relatedResult]=await env.DB.batch([
    env.DB.prepare('SELECT price,observed_at FROM (SELECT price,observed_at FROM offer_prices WHERE offer_id=? AND observed_at>=? ORDER BY observed_at DESC LIMIT 400) recent ORDER BY observed_at ASC').bind(id,since30d-335*86400),
    env.DB.prepare(`SELECT id,title,price,original_price,discount,rating,sales,shop,image_url,source,category,published_at,cataloged_at,last_checked_at,availability,coupon_code,coupon_condition,coupon_expires_at,payment_label FROM offers WHERE id!=? AND availability!='unavailable'${relatedFilter} ORDER BY discount DESC LIMIT 3`).bind(...relatedValues),
  ]);
  const canonical=`${SITE}${offerPath(offer)}`,productName=shorten(offer.title,180),sourceName=shorten(offer.source||'loja parceira',30),title=shorten(`${productName} por ${money(offer.price)} | Tá Barato`,65),description=shorten(`${productName} por ${money(offer.price)}${offer.discount?` com ${Math.round(offer.discount)}% de desconto`:''} na ${sourceName}. Confira preço e condições.`,155);
  const checked=new Date(Number(offer.last_checked_at||offer.published_at)*1000),checkedText=checked.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
  const inStock=offer.availability!=='unavailable';
  const product=productStructuredData(offer,canonical);
  const structured=JSON.stringify(product).replace(/</g,'\\u003c'),rating=offer.rating?`⭐ ${Number(offer.rating).toFixed(1)}`:'',sales=offer.sales?`${rating?' · ':''}${html(compact(offer.sales))} vendidos`:'';
  const coupon=couponActive(offer)?`<section class="coupon-inline"><span>CUPOM DISPONÍVEL</span><strong>${html(offer.coupon_code)}</strong>${offer.coupon_condition?`<p>${html(offer.coupon_condition)}</p>`:''}</section>`:'',flags=[offer.payment_label].filter(Boolean).map(value=>`<span>${html(value)}</span>`).join('');
  const todosPrecos=pricesResult.results||[],prices=todosPrecos.filter(row=>Number(row.observed_at)>=since30d).slice(-30),values=prices.map(row=>Number(row.price)),minPrice=values.length?Math.min(...values):Number(offer.price),maxPrice=values.length?Math.max(...values):Number(offer.price),averagePrice=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:Number(offer.price),hasVariation=maxPrice-minPrice>=.005,range=Math.max(.01,maxPrice-minPrice),firstPrice=values[0]||Number(offer.price),latestPrice=values.at(-1)||Number(offer.price),variation=firstPrice?((latestPrice-firstPrice)/firstPrice)*100:0,variationClass=!hasVariation?'flat':variation<0?'down':'up',variationText=!hasVariation?'Sem alteração':`${variation<0?'Caiu':'Subiu'} ${Math.abs(variation).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`,trackedText=prices.length===1?'1 dia registrado':`${prices.length} dias registrados`;
  const indexable=indexableOffer(offer,prices.length);
  const resumo=resumoPreco(values,offer.price,DIAS_SELO);
  const belowAverage=averagePrice?((averagePrice-latestPrice)/averagePrice)*100:0;
  let verdictClass='forming',verdictTitle='Histórico em formação',verdictText=`Já registramos ${prices.length} ${prices.length===1?'dia':'dias'} deste produto. A análise de preço começa com ${DIAS_SELO} dias.`;
  if(prices.length>=DIAS_SELO&&latestPrice<=minPrice+.005){verdictClass='great';verdictTitle='Melhor preço observado';verdictText=`Este é o menor valor entre os ${prices.length} registros dos últimos 30 dias.`;}
  else if(prices.length>=DIAS_SELO&&belowAverage>=5){verdictClass='good';verdictTitle='Preço abaixo da média';verdictText=`O valor atual está ${belowAverage.toLocaleString('pt-BR',{maximumFractionDigits:1})}% abaixo da média recente.`;}
  else if(prices.length>=DIAS_SELO&&latestPrice>averagePrice*1.05){verdictClass='high';verdictTitle='Preço acima da média';verdictText='Talvez valha acompanhar mais um pouco antes de comprar.';}
  else if(prices.length>=7){verdictClass='stable';verdictTitle='Preço dentro da média';verdictText='O valor atual está próximo da média registrada no período.';}
  const history=prices.length?`<section class="price-history"><div class="subsection-head"><div><p class="eyebrow">HISTÓRICO</p><h2>Preço observado</h2><p class="history-count">${html(trackedText)} nos últimos 30 dias</p></div></div><div class="price-verdict ${verdictClass}"><strong>${html(verdictTitle)}</strong><p>${html(verdictText)}</p></div>${regua(resumo,offer.price)}<div class="history-stats"><div><span>Preço atual</span><strong>${html(money(latestPrice))}</strong></div><div><span>Menor observado</span><strong>${html(money(minPrice))}</strong></div><div><span>Média observada</span><strong>${html(money(averagePrice))}</strong></div><div class="history-trend ${variationClass}"><span>Variação no período</span><strong>${html(variationText)}</strong></div></div>${prices.length===1?'<p class="history-start">O acompanhamento deste produto começou hoje. Os próximos preços serão adicionados diariamente.</p>':graficoComAbas(todosPrecos,Math.floor(Date.now()/1000))}<p class="history-note">Cada ponto mostra o preço observado em um dia. Com menos de ${DIAS_SELO} registros, evitamos classificar o valor como bom ou ruim. Este histórico não garante o menor preço de todo o mercado.</p></section>`:'',related=offer.category&&offer.category!=='outros'&&(relatedResult.results||[]).length?`<section class="related"><div class="subsection-head"><div><p class="eyebrow">VOCÊ TAMBÉM PODE GOSTAR</p><h2>Ofertas relacionadas</h2></div></div><div class="offer-grid">${relatedResult.results.map(offerCard).join('')}</div></section>`:'';
  const warning=offer.availability==='unavailable'?'<p class="offer-warning">Este produto não está disponível na consulta mais recente.</p>':offer.availability==='unverified'?'<p class="offer-warning">A plataforma não confirmou este produto na última consulta. Estamos verificando novamente.</p>':'';
  const alertBot=/^[A-Za-z0-9_]{5,32}$/.test(String(env.TELEGRAM_ALERTS_BOT_USERNAME||''))?env.TELEGRAM_ALERTS_BOT_USERNAME:'';
  // Quem chega pelo Google já tem intenção de compra: é o melhor público para o canal.
  // Atalho para o bot já criar o alerta deste produto (mesmo link dos posts do canal).
  const payload=payloadAlerta(offer.id);
  const alertaCta=payload&&inStock?`<section class="offer-alert"><div><strong>🔔 Avise-me quando baixar</strong><p>A gente acompanha o preço e te avisa no Telegram. Grátis.</p></div><a href="https://t.me/${html(botAlertas(env))}?start=${html(payload)}" target="_blank" rel="noopener noreferrer">Criar alerta ↗</a></section>`:'';
  // Mesmo produto em outras lojas do catálogo, com esta oferta na lista para comparar.
  const outras=inStock?await outrasLojasNoCatalogo(env,offer):[];
  const comparativo=outras.length?(()=>{
    const linhas=[{lojaNome:offer.source,preco:Number(offer.price),esta:true},...outras].sort((a,b)=>a.preco-b.preco);
    return `<section class="store-compare"><div class="subsection-head"><div><p class="eyebrow">COMPARE</p><h2>Mesmo produto em outras lojas</h2></div></div><ul>${linhas.map((l,i)=>`<li${l.esta?' class="is-this"':''}><span class="sc-store">${html(l.lojaNome)}${i===0?' <b class="sc-best">🏆 mais barato</b>':''}</span><strong>${html(money(l.preco))}</strong>${l.esta?'<span class="sc-this">esta oferta</span>':`<a href="${html(l.link)}" rel="nofollow sponsored">Ver na loja ↗</a>`}</li>`).join('')}</ul><p class="history-note">Comparação com produtos do nosso catálogo com o mesmo nome e modelo. Confira as condições na loja.</p></section>`;
  })():'';
  const telegramCta='<section class="stories-telegram offer-telegram"><div><p class="eyebrow">GRÁTIS NO TELEGRAM</p><h2>Receba ofertas como esta</h2><p>Todo dia, com preço conferido e histórico, sem depender do algoritmo das redes.</p></div><a class="buy" href="https://t.me/CanalTaBarato" rel="noopener noreferrer">Entrar no canal ↗</a>'+(alertBot?`<a class="offer-alert-link" href="https://t.me/${alertBot}?start=oferta" rel="noopener noreferrer">🔔 Ou crie um alerta do produto que você procura</a>`:'')+'</section>';
  const buy=inStock?`<a class="buy detail-buy" href="/go/${encodeURIComponent(offer.id)}" rel="nofollow sponsored">Ver preço atual no site oficial ↗</a>`:'<span class="buy detail-buy unavailable-buy">Indisponível no momento</span>';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical,structured,image:offer.image_url,indexable})}<script src="/offer.js?v=20261123-1" defer></script></head><body>${header()}<main class="offer-page"><nav class="breadcrumbs" aria-label="Navegação"><a href="/">Ofertas</a><span>›</span><a href="/categorias/${slugify(offer.category||'outros')}">${html(label(offer.category||'outros'))}</a><span>›</span><span>Produto</span></nav><article class="offer-detail"><div class="offer-detail-media">${offer.discount?`<span class="discount">−${Math.round(Number(offer.discount))}%</span>`:''}<img src="${html(offer.image_url)}" alt="${html(offer.title)}"></div><div class="offer-detail-body"><span class="source">${html(offer.source)}${offer.category?` · <a href="/categorias/${slugify(offer.category)}">${html(label(offer.category))}</a>`:''}</span><h1>${html(offer.title)}</h1>${flags?`<div class="offer-flags">${flags}</div>`:''}<div class="offer-detail-price"><span class="price">${html(money(offer.price))}</span>${offer.original_price?`<span class="was">${html(money(offer.original_price))}</span>`:''}</div>${inStock?linhaResumo(resumo):''}${rating||sales?`<p class="meta">${rating}${sales}</p>`:''}${coupon}${offer.shop?`<p class="offer-shop">Loja: <a href="/lojas/${slugify(offer.shop)}"><strong>${html(offer.shop)}</strong></a></p>`:''}${warning}${buy}${alertaCta}<div class="detail-actions"><button data-favorite="${html(offer.id)}">♥ Salvar</button><button data-share data-title="${html(offer.title)}" data-price="${html(money(offer.price))}">Compartilhar</button></div>${telegramCta}<p class="offer-detail-note">O valor mostrado é o último preço consultado. Frete, moedas, cupons e condições do aplicativo podem alterar o total no checkout. Este pode ser um link de afiliado, sem custo adicional para você.</p><button class="report-expired" data-offer-id="${html(offer.id)}">Preço mudou ou oferta acabou?</button><p class="offer-date">Preço verificado em ${html(checkedText)}</p></div></article>${comparativo}${history}${related}</main>${footer()}</body></html>`,200,'public, max-age=300, stale-while-revalidate=1800',indexable);
}

export async function onRequestHead(context) {
  return responseHead(await onRequestGet(context));
}

// Id da oferta -> /start do bot de alertas (ml_MLB…, sp_LOJA_ITEM, ae_ITEM).
// Amazon fica de fora: o bot ainda não lê preço de lá.
export function payloadAlerta(id) {
  const t=String(id||'');
  let m=t.match(/^mercadolivre_(MLB\d{3,20})$/i);
  if(m) return `ml_${m[1].toUpperCase()}`;
  m=t.match(/^shopee_(\d{1,15})_(\d{1,15})$/);
  if(m) return `sp_${m[1]}_${m[2]}`;
  m=t.match(/^aliexpress_(\d{6,20})$/);
  if(m) return `ae_${m[1]}`;
  return null;
}
const botAlertas=env=>/^[A-Za-z0-9_]{5,32}$/.test(String(env?.TELEGRAM_ALERTS_BOT_USERNAME||''))?env.TELEGRAM_ALERTS_BOT_USERNAME:'TaBaratoAlertaDePrecoBot';
