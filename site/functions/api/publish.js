import {authorized,json,safeUrl} from '../_lib.js';
import {notifyIndexNow} from '../_indexnow.js';
import {offerPath,slugify} from '../_site.js';

export async function onRequestPost(context) {
  const {request,env}=context;
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>32768) return json({error:'too_large'},413);
  let body; try{body=await request.json();}catch{return json({error:'invalid_json'},400);}
  const destination=safeUrl(body.destination,env.ALLOWED_DESTINATION_HOSTS);
  const image=safeUrl(body.image_url);
  const id=String(body.id||'').slice(0,100), title=String(body.title||'').trim().slice(0,180);
  const price=Number(body.price), discount=Math.max(0,Math.min(100,Number(body.discount)||0));
  const couponCode=String(body.coupon_code||'').trim().slice(0,60)||null;
  const couponCondition=String(body.coupon_condition||'').trim().slice(0,220)||null;
  const couponExpires=Number(body.coupon_expires_at)||null;
  const paymentLabel=String(body.payment_label||'').trim().slice(0,60)||null;
  if(!id||!title||!destination||!image||!Number.isFinite(price)||price<=0) return json({error:'invalid_offer'},400);
  const now=Math.floor(Date.now()/1000);
  const source=String(body.source||'').slice(0,30);
  const category=String(body.category||'outros').slice(0,50);
  const shop=String(body.shop||'').slice(0,100);
  await env.DB.prepare(`INSERT INTO offers(id,title,price,original_price,discount,rating,sales,shop,image_url,destination,source,category,published_at,coupon_code,coupon_condition,coupon_expires_at,payment_label) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,price=excluded.price,original_price=excluded.original_price,discount=excluded.discount,rating=excluded.rating,sales=excluded.sales,shop=excluded.shop,image_url=excluded.image_url,destination=excluded.destination,source=excluded.source,category=excluded.category,published_at=excluded.published_at,coupon_code=excluded.coupon_code,coupon_condition=excluded.coupon_condition,coupon_expires_at=excluded.coupon_expires_at,payment_label=excluded.payment_label`).bind(id,title,price,Number(body.original_price)||null,discount,Number(body.rating)||null,Number(body.sales)||null,shop,image,destination,source,category,now,couponCode,couponCondition,couponExpires,paymentLabel).run();
  context.waitUntil(env.DB.prepare('DELETE FROM offers WHERE published_at<?').bind(now-30*86400).run());
  context.waitUntil(notifyIndexNow([offerPath({id,title}),`/categorias/${slugify(category)}`,shop?`/lojas/${slugify(shop)}`:'/']));
  return json({ok:true},201);
}
