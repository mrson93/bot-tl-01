import {SITE,footer,head,header,html,responseHtml} from './_site.js';

const EXTERNAL_API='https://www.cupomdesconto.com.br/api/public/coupons?active=true&limit=100';
const EXTERNAL_ORIGIN='https://www.cupomdesconto.com.br';
const EXTERNAL_MAX_AGE_MS=3*86400*1000;
const FOREIGN_REGION=/\b(chile|argentina|mexico|colombia|peru|espanha|ecuador|uruguai)\b/i;

function dateLabel(timestamp) {
  if(!timestamp) return 'Validade não informada';
  return `Válido até ${new Date(Number(timestamp)*1000).toLocaleString('pt-BR',{
    timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})}`;
}

function normalized(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}

async function externalCoupons(stores,now) {
  const available=new Map(stores.map(store=>[String(store.slug),String(store.name)]));
  if(!available.size) return [];
  try {
    const response=await fetch(EXTERNAL_API,{
      headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000),
      cf:{cacheEverything:true,cacheTtl:3600},
    });
    if(!response.ok) return [];
    const data=await response.json();
    if(!data.success||!Array.isArray(data.coupons)) return [];
    return data.coupons.map(coupon=>{
      const slug=String(coupon.store?.slug||'').toLowerCase();
      const code=String(coupon.code||'').trim().slice(0,60);
      const updatedAt=Date.parse(String(coupon.updatedAt||''));
      const context=normalized(`${coupon.title||''} ${coupon.description||''}`);
      if(!available.has(slug)||!coupon.verified||!/^[-A-Z0-9_]{3,40}$/i.test(code)||
         !Number.isFinite(updatedAt)||updatedAt>now*1000+5*60*1000||
         now*1000-updatedAt>EXTERNAL_MAX_AGE_MS||FOREIGN_REGION.test(context)) return null;
      return {
        id:`external:${String(coupon.id||code).slice(0,100)}`,
        source:available.get(slug),code,
        title:String(coupon.title||code).trim().slice(0,180),
        condition:String(coupon.description||'').trim().slice(0,220),
        expires_at:null,href:`/loja/${encodeURIComponent(slug)}`,external:true,
        origin:`${EXTERNAL_ORIGIN}/cupom-${encodeURIComponent(slug)}`,
      };
    }).filter(Boolean).slice(0,18);
  } catch (error) {
    console.warn(JSON.stringify({event:'external_coupon_feed_unavailable',
      reason:error instanceof Error?error.name:'unknown'}));
    return [];
  }
}

function couponCard(coupon) {
  const hasCode=Boolean(coupon.code);
  const primary=hasCode?coupon.code:(coupon.title||'Voucher disponível');
  const href=coupon.href||`/cupom/${encodeURIComponent(coupon.id)}`;
  const validity=coupon.external?'Atualizado recentemente':dateLabel(coupon.expires_at);
  const primaryAction=hasCode
    ?`<a class="coupon-code coupon-code-action coupon-redeem" href="${html(href)}" target="_blank" rel="nofollow sponsored noopener" data-code="${html(coupon.code)}" aria-label="Copiar o cupom ${html(coupon.code)} e abrir a loja"><span>${html(primary)}</span><small class="coupon-action-label">Copiar e abrir a loja ↗</small></a>`
    :`<strong class="coupon-code coupon-title">${html(primary)}</strong>`;
  const origin=coupon.external
    ?`<p class="coupon-origin">Fonte complementar: <a href="${html(coupon.origin)}" target="_blank" rel="noopener noreferrer nofollow">CupomDesconto</a> · confirme o código no carrinho.</p>`:'';
  const voucherAction=!hasCode
    ?`<div class="coupon-actions coupon-actions-single"><a class="buy" href="${html(href)}" target="_blank" rel="nofollow sponsored noopener">Ativar voucher ↗</a></div>`:'';
  return `<article class="coupon-card"><div class="coupon-card-head"><span>${html(coupon.source)}</span><small>${html(validity)}</small></div>${primaryAction}${coupon.condition?`<p>${html(coupon.condition)}</p>`:'<p>Confira as condições no aplicativo antes de finalizar.</p>'}${origin}${voucherAction}</article>`;
}

function storeShortcuts(stores) {
  if(!stores.length) return '';
  return `<section class="store-shortcuts coupon-stores"><div class="store-shortcuts-head"><div><p class="eyebrow">COMPRE DIRETO</p><h2>Ir para a loja</h2></div><p>Abra a página principal usando nosso link de afiliado.</p></div><nav class="store-links" aria-label="Lojas parceiras">${stores.map(store=>`<a class="store-button store-${html(store.slug)}" href="/loja/${encodeURIComponent(store.slug)}" target="_blank" rel="nofollow sponsored noopener"><span>${html(store.name)}</span><b>↗</b></a>`).join('')}</nav></section>`;
}

function vipBanner(stores) {
  if(!stores.some(store=>store.slug==='shopee-vip')) return '';
  return `<section class="vip-banner"><div><p class="eyebrow">BENEFÍCIOS NA SHOPEE</p><h2>Conheça o Shopee VIP</h2><p>Veja as vantagens, o valor e as condições atuais diretamente na página oficial.</p></div><a href="/loja/shopee-vip" target="_blank" rel="nofollow sponsored noopener">Conhecer o Shopee VIP <span>↗</span></a></section>`;
}

export async function onRequestGet({env}) {
  const now=Math.floor(Date.now()/1000);
  const [result,storeResult]=await Promise.all([
    env.DB.prepare(`SELECT id,source,code,title,kind,condition,active_at,
      expires_at,published_at FROM coupons WHERE expires_at IS NULL OR expires_at>?
      ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,expires_at ASC,published_at DESC LIMIT 100`
    ).bind(now).all(),
    env.DB.prepare('SELECT slug,name FROM store_links ORDER BY name').all(),
  ]);
  const official=(result.results||[]).map(coupon=>({...coupon,href:`/cupom/${encodeURIComponent(coupon.id)}`}));
  const external=await externalCoupons(storeResult.results||[],now);
  const seen=new Set(official.filter(coupon=>coupon.code).map(coupon=>`${normalized(coupon.source)}:${String(coupon.code).toUpperCase()}`));
  const additional=external.filter(coupon=>{const key=`${normalized(coupon.source)}:${coupon.code.toUpperCase()}`;if(seen.has(key)) return false;seen.add(key);return true;});
  const coupons=[...official,...additional];
  const canonical=`${SITE}/cupons`;
  const title='Cupons de desconto ativos | Tá Barato';
  const description='Cupons encontrados em fontes oficiais e complementares, com condições e nosso link de afiliado para a loja.';
  const cards=coupons.map(couponCard).join('');
  const stores=storeResult.results||[];
  const regularStores=stores.filter(store=>store.slug!=='shopee-vip');
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical})}<script src="/coupons.js" defer></script></head><body>${header('coupons')}<main class="coupons-page"><div class="collection-heading"><p class="eyebrow">ECONOMIA EXTRA</p><h1>Cupons ativos</h1><p>Clique no código para copiá-lo e abrir a loja em uma nova aba. Confirme a validade e as condições antes de finalizar.</p><strong>${coupons.length} ${coupons.length===1?'benefício disponível':'benefícios disponíveis'}</strong></div>${vipBanner(stores)}${storeShortcuts(regularStores)}${coupons.length?`<div class="coupon-grid">${cards}</div>`:'<div class="empty"><span>🎟</span><h2>Nenhum cupom ativo agora</h2><p>Quando encontrarmos um código ou voucher válido, ele aparecerá aqui automaticamente.</p></div>'}</main>${footer()}</body></html>`);
}
