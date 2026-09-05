import {authorized,json,safeUrl} from '../_lib.js';
import {notifyIndexNow} from '../_indexnow.js';

export async function onRequestGet({env}) {
  const now=Math.floor(Date.now()/1000);
  const result=await env.DB.prepare(`SELECT id,source,code,condition,active_at,
    expires_at,published_at FROM coupons WHERE expires_at IS NULL OR expires_at>?
    ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END,expires_at ASC,published_at DESC LIMIT 100`
  ).bind(now).all();
  return json({coupons:result.results||[]},200,'public, max-age=60, stale-while-revalidate=300');
}

export async function onRequestPost(context) {
  const {request,env}=context;
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>16384) return json({error:'too_large'},413);
  let body;try{body=await request.json();}catch{return json({error:'invalid_json'},400);}
  const destination=safeUrl(body.destination,env.ALLOWED_DESTINATION_HOSTS);
  const id=String(body.id||'').slice(0,100);
  const source=String(body.source||'').trim().slice(0,30);
  const code=String(body.code||'').trim().slice(0,60);
  const condition=String(body.condition||'').trim().slice(0,220)||null;
  const activeAt=Number(body.active_at)||null;
  const expiresAt=Number(body.expires_at)||null;
  if(!id||!source||!code||!destination) return json({error:'invalid_coupon'},400);
  const now=Math.floor(Date.now()/1000);
  if(expiresAt&&expiresAt<=now) return json({error:'expired_coupon'},409);
  await env.DB.prepare(`INSERT INTO coupons(id,source,code,condition,destination,
    active_at,expires_at,published_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id)
    DO UPDATE SET source=excluded.source,code=excluded.code,condition=excluded.condition,
    destination=excluded.destination,active_at=excluded.active_at,
    expires_at=excluded.expires_at,published_at=excluded.published_at`
  ).bind(id,source,code,condition,destination,activeAt,expiresAt,now).run();
  context.waitUntil(env.DB.prepare('DELETE FROM coupons WHERE expires_at IS NOT NULL AND expires_at<?').bind(now-86400).run());
  context.waitUntil(notifyIndexNow(['/cupons']));
  return json({ok:true},201);
}
