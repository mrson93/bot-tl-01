import {authorized,json,safeUrl} from '../_lib.js';
import {notifyIndexNow} from '../_indexnow.js';
import {normalizeCategory,offerPath} from '../_site.js';

const nullableNumber=value=>value===null||value===undefined||value===''?null:Number(value);

export async function onRequestPost(context) {
  const {request,env}=context;
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>65536) return json({error:'too_large'},413);
  let body;try{body=await request.json();}catch{return json({error:'invalid_json'},400);}
  if(!Array.isArray(body.updates)||body.updates.length<1||body.updates.length>20) return json({error:'invalid_updates'},400);
  const now=Math.floor(Date.now()/1000),day=new Date(now*1000).toISOString().slice(0,10);
  const statements=[],changed=[];
  for(const raw of body.updates) {
    const id=String(raw.id||'').slice(0,100),found=raw.found===true;
    if(!id||!/^((shopee_[0-9]+_[0-9]+)|(aliexpress_[0-9]+)|(amazon_[A-Z0-9]{10})|(mercadolivre_MLB[0-9]+))$/.test(id)) return json({error:'invalid_update'},400);
    if(!found) {
      statements.push(env.DB.prepare(`UPDATE offers SET last_checked_at=?,refresh_failures=MIN(refresh_failures+1,3),availability=CASE WHEN refresh_failures+1>=3 THEN 'unavailable' ELSE 'unverified' END WHERE id=?`).bind(now,id));
      continue;
    }
    const title=String(raw.title||'').trim().slice(0,180),price=Number(raw.price);
    const original=nullableNumber(raw.original_price),rating=nullableNumber(raw.rating),sales=nullableNumber(raw.sales);
    const discount=Math.max(0,Math.min(100,Number(raw.discount)||0));
    const shop=String(raw.shop||'').trim().slice(0,100),image=safeUrl(raw.image_url);
    if(!title||!Number.isFinite(price)||price<=0||!image) return json({error:'invalid_product'},400);
    const category=normalizeCategory(`${raw.category||''} ${title}`);
    statements.push(env.DB.prepare(`UPDATE offers SET title=?,price_changed_at=CASE WHEN price<>? THEN ? ELSE COALESCE(price_changed_at,?) END,price=?,original_price=?,discount=?,rating=?,sales=?,shop=?,image_url=?,category=?,payment_label=?,last_checked_at=?,last_seen_at=?,availability='active',refresh_failures=0 WHERE id=?`).bind(title,price,now,now,price,Number.isFinite(original)?original:null,discount,Number.isFinite(rating)?rating:null,Number.isFinite(sales)?sales:null,shop,image,category,String(raw.payment_label||'').trim().slice(0,60)||null,now,now,id));
    statements.push(env.DB.prepare(`INSERT INTO offer_prices(offer_id,observed_on,price,observed_at) SELECT id,?,?,? FROM offers WHERE id=? ON CONFLICT(offer_id,observed_on) DO UPDATE SET price=excluded.price,observed_at=excluded.observed_at`).bind(day,price,now,id));
    changed.push({id,title});
  }
  await env.DB.batch(statements);
  if(changed.length) context.waitUntil(notifyIndexNow(changed.map(offerPath)));
  return json({ok:true,processed:body.updates.length,available:changed.length});
}
