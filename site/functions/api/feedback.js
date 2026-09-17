import {claimPublicAction} from '../_abuse.js';
import {json,readJsonLimited} from '../_lib.js';

export async function onRequestPost({request,env}) {
  const origin=request.headers.get('Origin'),fetchSite=request.headers.get('Sec-Fetch-Site');
  if(origin!==new URL(request.url).origin||(fetchSite&&fetchSite!=='same-origin')) return json({error:'forbidden'},403);
  if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')) return json({error:'unsupported_media_type'},415);
  if(Number(request.headers.get('Content-Length')||0)>2048) return json({error:'too_large'},413);
  let body;
  try{body=await readJsonLimited(request,2048);}catch(error){
    return json({error:String(error?.message||error)==='too_large'?'too_large':'invalid_json'},
      String(error?.message||error)==='too_large'?413:400);
  }
  const id=String(body.offer_id||'').slice(0,100),kind=String(body.kind||'');
  if(!id||!['expired','available'].includes(kind)) return json({error:'invalid_feedback'},400);
  const exists=await env.DB.prepare('SELECT 1 ok FROM offers WHERE id=?').bind(id).first();
  if(!exists) return json({error:'not_found'},404);
  const claim=await claimPublicAction({env,request,purpose:'feedback',resource:`${id}:${kind}`,
    windowSeconds:86400,limiter:env.FEEDBACK_RATE_LIMITER});
  if(claim.reason==='rate_limited') return json({error:'rate_limited'},429);
  if(['misconfigured','rate_limiter_error'].includes(claim.reason)) return json({error:'temporarily_unavailable'},503);
  if(!claim.accepted) return json({ok:true,duplicate:true},202);
  await env.DB.prepare(`INSERT INTO offer_feedback(offer_id,kind,quantity,updated_at) VALUES(?,?,1,?) ON CONFLICT(offer_id,kind) DO UPDATE SET quantity=MIN(quantity+1,99),updated_at=excluded.updated_at`).bind(id,kind,Math.floor(Date.now()/1000)).run();
  return json({ok:true},201);
}
