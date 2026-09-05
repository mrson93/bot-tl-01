import {SITE,footer,head,header,html,responseHtml} from './_site.js';

function dateLabel(timestamp) {
  if(!timestamp) return 'Validade não informada';
  return `Válido até ${new Date(Number(timestamp)*1000).toLocaleString('pt-BR',{
    timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})}`;
}

export async function onRequestGet({env}) {
  const now=Math.floor(Date.now()/1000);
  const result=await env.DB.prepare(`SELECT id,source,code,condition,active_at,
    expires_at,published_at FROM coupons WHERE expires_at IS NULL OR expires_at>?
    ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,expires_at ASC,published_at DESC LIMIT 100`
  ).bind(now).all();
  const coupons=result.results||[];
  const canonical=`${SITE}/cupons`;
  const title='Cupons de desconto ativos | Tá Barato';
  const description='Cupons oficiais encontrados nas plataformas parceiras, com condições, validade e link para resgate.';
  const cards=coupons.map(coupon=>`<article class="coupon-card"><div class="coupon-card-head"><span>${html(coupon.source)}</span><small>${html(dateLabel(coupon.expires_at))}</small></div><strong class="coupon-code">${html(coupon.code)}</strong>${coupon.condition?`<p>${html(coupon.condition)}</p>`:'<p>Confira as condições no aplicativo antes de finalizar.</p>'}<div class="coupon-actions"><button class="copy-coupon" type="button" data-code="${html(coupon.code)}">Copiar código</button><a class="buy" href="/cupom/${encodeURIComponent(coupon.id)}" rel="nofollow sponsored">Resgatar cupom ↗</a></div></article>`).join('');
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical})}<script src="/coupons.js" defer></script></head><body>${header('coupons')}<main class="coupons-page"><div class="collection-heading"><p class="eyebrow">ECONOMIA EXTRA</p><h1>Cupons ativos</h1><p>Somente cupons encontrados em páginas oficiais de resgate. Confirme a validade e as condições na loja.</p><strong>${coupons.length} ${coupons.length===1?'cupom disponível':'cupons disponíveis'}</strong></div>${coupons.length?`<div class="coupon-grid">${cards}</div>`:'<div class="empty"><span>🎟</span><h2>Nenhum cupom ativo agora</h2><p>Quando uma plataforma liberar um código oficial, ele aparecerá aqui automaticamente.</p></div>'}</main>${footer()}</body></html>`);
}
