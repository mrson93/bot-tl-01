import {json} from '../_lib.js';
export async function onRequestGet({env}) {
  const since=Math.floor(Date.now()/1000)-7*86400;
  const clickSince=Math.floor(Date.now()/1000)-86400;
  const result=await env.DB.prepare(`SELECT o.id,o.title,o.price,o.original_price,
    o.discount,o.rating,o.sales,o.shop,o.image_url,o.source,o.category,
    o.published_at,o.coupon_code,o.coupon_condition,o.coupon_expires_at,
    o.payment_label,COALESCE(c.quantity,0) clicks_24h FROM offers o
    LEFT JOIN (SELECT offer_id,COUNT(*) quantity FROM clicks WHERE clicked_at>=?
      GROUP BY offer_id) c ON c.offer_id=o.id
    WHERE o.published_at>=? ORDER BY o.published_at DESC LIMIT 100`
  ).bind(clickSince,since).all();
  return json({offers:result.results||[]},200,'public, max-age=60, stale-while-revalidate=300');
}
