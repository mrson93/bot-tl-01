import {claimPublicAction} from '../_abuse.js';
import {json,readJsonLimited} from '../_lib.js';

const ALLOWED=/^\/(?:$|stories$|blog(?:\/[^/?#]{1,100})?$|oferta\/[^/?#]{1,200}$|cupons$|quedas-de-preco$|menores-precos$|mais-acessadas$|mais-vendidos$|categorias\/[^/?#]{1,80}$|lojas\/[^/?#]{1,80}$|faixas-de-preco\/(?:ate-50|de-50-a-100|de-100-a-200|acima-de-200)$)/;
const SOURCES=new Set(['facebook','instagram','telegram','bluesky','x','google','bing','direct','other']);

function saoPauloDay() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

export async function onRequestPost({request,env}) {
  if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')) return json({error:'unsupported_media_type'},415);
  if(Number(request.headers.get('Content-Length')||0)>2048) return json({error:'too_large'},413);
  let data;
  try{data=await readJsonLimited(request,2048);}catch(error){
    return json({error:String(error?.message||error)==='too_large'?'too_large':'invalid_json'},
      String(error?.message||error)==='too_large'?413:400);
  }
  const path=String(data?.path||'').slice(0,220);
  const source=SOURCES.has(String(data?.source||'').toLowerCase())?String(data.source).toLowerCase():'other';
  if(!ALLOWED.test(path)) return json({error:'invalid_path'},400);
  const claim=await claimPublicAction({env,request,purpose:'view',resource:`${path}:${source}`,
    windowSeconds:600,limiter:env.METRICS_RATE_LIMITER});
  if(claim.reason==='rate_limited') return json({error:'rate_limited'},429);
  if(['misconfigured','rate_limiter_error'].includes(claim.reason)) return json({ok:true,tracked:false},202);
  if(!claim.accepted) return json({ok:true,duplicate:true},202);
  const day=saoPauloDay();
  const insert=()=>env.DB.batch([
    env.DB.prepare(`INSERT INTO page_views_daily(observed_on,path,quantity) VALUES(?,?,1)
      ON CONFLICT(observed_on,path) DO UPDATE SET quantity=quantity+1`).bind(day,path),
    env.DB.prepare(`INSERT INTO traffic_sources_daily(observed_on,source,landing_path,quantity) VALUES(?,?,?,1)
      ON CONFLICT(observed_on,source,landing_path) DO UPDATE SET quantity=quantity+1`).bind(day,source,path)
  ]);
  try{await insert();}catch(error){
    if(!String(error?.message||error).toLowerCase().includes('no such table')) throw error;
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS page_views_daily (observed_on TEXT NOT NULL,path TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY (observed_on,path))'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS traffic_sources_daily (observed_on TEXT NOT NULL,source TEXT NOT NULL,landing_path TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY (observed_on,source,landing_path))')
    ]);
    await insert();
  }
  return json({ok:true},202);
}
