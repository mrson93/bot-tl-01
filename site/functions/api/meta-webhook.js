import {readBytesLimited} from '../_lib.js';
import {extractInboundEvents,processInboundEvent,verifyMetaSignature} from '../_instagram_dm.js';

const MAX_WEBHOOK_BYTES=262_144;

async function secureEqual(left,right) {
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(String(left||''))),
    crypto.subtle.digest('SHA-256',encoder.encode(String(right||''))),
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;
  for(let index=0;index<x.length;index++) difference|=x[index]^y[index];
  return difference===0;
}

export async function onRequestGet({request,env}) {
  const url=new URL(request.url),mode=url.searchParams.get('hub.mode');
  const token=url.searchParams.get('hub.verify_token');
  const challenge=String(url.searchParams.get('hub.challenge')||'').slice(0,256);
  if(mode==='subscribe'&&challenge&&await secureEqual(token,env.META_WEBHOOK_VERIFY_TOKEN)){
    return new Response(challenge,{status:200,headers:{'Content-Type':'text/plain;charset=UTF-8','Cache-Control':'no-store'}});
  }
  return new Response('Forbidden',{status:403});
}

export async function onRequestPost(context) {
  const {request,env}=context;
  if(Number(request.headers.get('Content-Length')||0)>MAX_WEBHOOK_BYTES) return new Response('Too large',{status:413});
  let raw;
  try{raw=await readBytesLimited(request,MAX_WEBHOOK_BYTES);}catch{return new Response('Too large',{status:413});}
  if(!await verifyMetaSignature(raw,request.headers.get('X-Hub-Signature-256'),env.META_APP_SECRET)){
    return new Response('Unauthorized',{status:401});
  }
  let payload;
  try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{return new Response('Bad request',{status:400});}
  const events=extractInboundEvents(payload,env.META_INSTAGRAM_ACCOUNT_ID).slice(0,25);
  if(!events.length) return new Response('OK',{status:200});
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS instagram_dm_events(event_hash TEXT PRIMARY KEY,status TEXT NOT NULL,created_at INTEGER NOT NULL)`).run();
  let failed=false;
  for(const event of events){
    try{
      const result=await processInboundEvent(env,event);
      console.log(JSON.stringify({event:'instagram_direct',result}));
    }catch(error){
      failed=true;
      console.error(JSON.stringify({event:'instagram_direct',result:'failed',reason:String(error?.message||error).slice(0,80)}));
    }
  }
  const cutoff=Math.floor(Date.now()/1000)-48*3600;
  context.waitUntil(env.DB.prepare('DELETE FROM instagram_dm_events WHERE created_at<?').bind(cutoff).run());
  return new Response(failed?'Retry':'OK',{status:failed?500:200});
}
