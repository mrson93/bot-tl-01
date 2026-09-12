import {authorized,json,readJsonLimited,safeUrl} from '../_lib.js';

const MAX_REQUEST_BYTES=16_384;

export async function onRequestPost(context) {
  const {request,env}=context;
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>MAX_REQUEST_BYTES) return json({error:'too_large'},413);
  let body;
  try{body=await readJsonLimited(request,MAX_REQUEST_BYTES);}catch(error){
    return json({error:error?.message==='too_large'?'too_large':'invalid_json'},error?.message==='too_large'?413:400);
  }
  const mediaId=String(body.media_id||''),containerId=String(body.container_id||'');
  const offerId=String(body.offer_id||'').slice(0,100);
  const title=String(body.title||'Oferta').trim().slice(0,180);
  const price=Number(body.price)||null;
  const link=safeUrl(body.link,env.ALLOWED_DESTINATION_HOSTS);
  if(!/^\d{5,40}$/.test(mediaId)||!/^\d{5,40}$/.test(containerId)||!title||!link||!env.ALLOWED_DESTINATION_HOSTS) return json({error:'invalid_story'},400);
  const now=Math.floor(Date.now()/1000),expires=now+7*86400;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS instagram_story_offers(media_id TEXT PRIMARY KEY,container_id TEXT NOT NULL,offer_id TEXT,title TEXT NOT NULL,price REAL,link TEXT NOT NULL,published_at INTEGER NOT NULL,expires_at INTEGER NOT NULL)`).run();
  await env.DB.prepare(`INSERT INTO instagram_story_offers(media_id,container_id,offer_id,title,price,link,published_at,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(media_id) DO UPDATE SET container_id=excluded.container_id,offer_id=excluded.offer_id,title=excluded.title,price=excluded.price,link=excluded.link,published_at=excluded.published_at,expires_at=excluded.expires_at`).bind(mediaId,containerId,offerId,title,price,link,now,expires).run();
  context.waitUntil(env.DB.prepare('DELETE FROM instagram_story_offers WHERE expires_at<?').bind(now).run());
  return json({ok:true},201);
}
