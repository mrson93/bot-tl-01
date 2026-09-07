import {json} from '../_lib.js';

export async function onRequestPost({request,env}) {
  const origin=request.headers.get('Origin'),fetchSite=request.headers.get('Sec-Fetch-Site');
  if(origin!==new URL(request.url).origin||(fetchSite&&fetchSite!=='same-origin')) return json({error:'forbidden'},403);
  if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')) return json({error:'unsupported_media_type'},415);
  if(Number(request.headers.get('Content-Length')||0)>2048) return json({error:'too_large'},413);
  let body;try{body=await request.json();}catch{return json({error:'invalid_json'},400);}
  const id=String(body.offer_id||'').slice(0,100),kind=String(body.kind||'');
  if(!id||!['expired','available'].includes(kind)) return json({error:'invalid_feedback'},400);
  const exists=await env.DB.prepare('SELECT 1 ok FROM offers WHERE id=?').bind(id).first();
  if(!exists) return json({error:'not_found'},404);
  await env.DB.prepare(`INSERT INTO offer_feedback(offer_id,kind,quantity,updated_at) VALUES(?,?,1,?) ON CONFLICT(offer_id,kind) DO UPDATE SET quantity=MIN(quantity+1,99),updated_at=excluded.updated_at`).bind(id,kind,Math.floor(Date.now()/1000)).run();
  return json({ok:true},201);
}
