import {claimPublicAction} from '../_abuse.js';
import {json,readJsonLimited} from '../_lib.js';

const SOURCES=new Set(['facebook','instagram','telegram','bluesky','x','google','bing','direct','other']);
const DEVICES=new Set(['mobile','desktop']);
const OUTCOMES=new Set(['results','empty']);
const dayInSaoPaulo=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export async function onRequestPost({request,env}){
  if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))return json({error:'unsupported_media_type'},415);
  let data;try{data=await readJsonLimited(request,512);}catch(error){return json({error:error?.message==='too_large'?'too_large':'invalid_json'},error?.message==='too_large'?413:400);}
  const source=SOURCES.has(data?.source)?data.source:'other',device=data?.device,outcome=data?.outcome;
  if(!DEVICES.has(device)||!OUTCOMES.has(outcome))return json({error:'invalid_event'},400);
  const claim=await claimPublicAction({env,request,purpose:'catalog-search',resource:`${source}:${device}:${outcome}`,windowSeconds:1800,limiter:env.METRICS_RATE_LIMITER});
  if(claim.reason==='rate_limited')return json({error:'rate_limited'},429);
  if(['misconfigured','rate_limiter_error'].includes(claim.reason))return json({ok:true,tracked:false},202);
  if(!claim.accepted)return json({ok:true,duplicate:true},202);
  const insert=()=>env.DB.prepare(`INSERT INTO catalog_search_daily(observed_on,source,device,outcome,quantity) VALUES(?,?,?,?,1)
    ON CONFLICT(observed_on,source,device,outcome) DO UPDATE SET quantity=quantity+1`).bind(dayInSaoPaulo(),source,device,outcome).run();
  try{await insert();}catch(error){
    if(!String(error?.message||error).toLowerCase().includes('no such table'))throw error;
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS catalog_search_daily(observed_on TEXT NOT NULL,source TEXT NOT NULL,
      device TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('results','empty')),
      quantity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(observed_on,source,device,outcome))`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_catalog_search_date ON catalog_search_daily(observed_on)').run();
    await insert();
  }
  return json({ok:true},202);
}
