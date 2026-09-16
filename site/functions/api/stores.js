import {authorized,json,safeUrl} from '../_lib.js';

const STORES={
  Shopee:{slug:'shopee',name:'Shopee'},
  'Shopee VIP':{slug:'shopee-vip',name:'Shopee VIP'},
  AliExpress:{slug:'aliexpress',name:'AliExpress'},
  Amazon:{slug:'amazon',name:'Amazon'},
  'Mercado Livre':{slug:'mercadolivre',name:'Mercado Livre'},
};

export async function onRequestGet({env}) {
  const result=await env.DB.prepare('SELECT slug,name,updated_at FROM store_links ORDER BY name').all();
  return json({stores:result.results||[]},200,'public, max-age=300, stale-while-revalidate=900');
}

export async function onRequestPost({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>8192) return json({error:'too_large'},413);
  let body;try{body=await request.json();}catch{return json({error:'invalid_json'},400);}
  const store=STORES[String(body.source||'').trim()];
  const destination=safeUrl(body.destination,env.ALLOWED_DESTINATION_HOSTS);
  if(!store||!destination) return json({error:'invalid_store'},400);
  const now=Math.floor(Date.now()/1000);
  await env.DB.prepare(`INSERT INTO store_links(slug,name,destination,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,
    destination=excluded.destination,updated_at=excluded.updated_at`
  ).bind(store.slug,store.name,destination,now).run();
  return json({ok:true,slug:store.slug},201);
}
