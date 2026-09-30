import {claimPublicAction} from '../_abuse.js';
import {json,readJsonLimited} from '../_lib.js';

const CREATE_TABLE=`CREATE TABLE IF NOT EXISTS editorial_metrics_daily (
  observed_on TEXT NOT NULL,post_slug TEXT NOT NULL,product_id TEXT NOT NULL,
  store TEXT NOT NULL DEFAULT '',placement TEXT NOT NULL,source TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('view','click')),
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (observed_on,post_slug,product_id,store,placement,source,event_type)
)`;
const SOURCES=new Set(['facebook','instagram','telegram','bluesky','x','google','bing','direct','other']);
const STORES=new Set(['amazon','mercado-livre','outro']);
const PLACEMENTS=new Set(['model-card','comparison-table','inline-card']);
const dayInSaoPaulo=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export async function onRequestPost({request,env}){
  if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))return json({error:'unsupported_media_type'},415);
  let data;try{data=await readJsonLimited(request,2048);}catch{return json({error:'invalid_json'},400);}
  const slug=String(data?.post_slug||''),productId=String(data?.product_id||''),eventType=String(data?.event_type||''),placement=String(data?.placement||''),source=SOURCES.has(String(data?.source||''))?String(data.source):'other',store=String(data?.store||'');
  if(!/^[a-z0-9-]{1,100}$/.test(slug)||!/^[a-zA-Z0-9_-]{1,100}$/.test(productId)||!['view','click'].includes(eventType)||!PLACEMENTS.has(placement))return json({error:'invalid_event'},400);
  if((eventType==='click'&&!STORES.has(store))||(eventType==='view'&&store))return json({error:'invalid_store'},400);
  const post=await env.DB.prepare(`SELECT p.id FROM blog_posts p JOIN blog_post_products m ON m.post_id=p.id
    WHERE p.slug=? AND p.status='published' AND p.published_at<=? AND m.id=?`).bind(slug,Math.floor(Date.now()/1000),productId).first();
  if(!post)return json({error:'unknown_product'},404);
  if(eventType==='click'){
    const link=store==='outro'
      ?await env.DB.prepare("SELECT id FROM blog_post_products WHERE post_id=? AND id=? AND affiliate_url!=''").bind(post.id,productId).first()
      :await env.DB.prepare('SELECT id FROM blog_product_links WHERE post_id=? AND product_id=? AND store=? LIMIT 1').bind(post.id,productId,store).first();
    if(!link)return json({error:'unknown_store_link'},404);
  }
  const claim=await claimPublicAction({env,request,purpose:`editorial-${eventType}`,resource:`${slug}:${productId}:${store}:${placement}:${source}`,windowSeconds:eventType==='view'?1800:60,limiter:env.METRICS_RATE_LIMITER});
  if(claim.reason==='rate_limited')return json({error:'rate_limited'},429);
  if(['misconfigured','rate_limiter_error'].includes(claim.reason))return json({ok:true,tracked:false},202);
  if(!claim.accepted)return json({ok:true,duplicate:true},202);
  await env.DB.prepare(CREATE_TABLE).run();
  await env.DB.prepare(`INSERT INTO editorial_metrics_daily(observed_on,post_slug,product_id,store,placement,source,event_type,quantity)
    VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(observed_on,post_slug,product_id,store,placement,source,event_type)
    DO UPDATE SET quantity=quantity+1`).bind(dayInSaoPaulo(),slug,productId,store,placement,source,eventType).run();
  return json({ok:true},202);
}
