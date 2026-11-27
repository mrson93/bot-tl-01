import {authorized,json,readJsonLimited} from '../_lib.js';

// Cupons públicos de campanha da página de cupons do Mercado Livre, lidos
// pela extensão "Tá Barato · Mercado Livre" no navegador do dono do canal.
// O bot lê esta cópia, escolhe os melhores e publica no site (/cupons) e nos
// canais com o link de afiliado da página de cupons.
const MAX_REQUEST_BYTES=200_000;
const MAX_COUPONS=300;
const CAMPANHA=/^\d{4,15}$/;

function texto(valor,limite){
  const t=String(valor||'').replace(/\s+/g,' ').trim();
  return t?t.slice(0,limite):'';
}
function reais(valor){
  const n=Number(valor);
  return Number.isFinite(n)&&n>=0&&n<1_000_000?Math.round(n*100)/100:null;
}
function momento(valor){
  const n=Number(valor);
  return Number.isInteger(n)&&n>1_600_000_000&&n<2_200_000_000?n:null;
}

export function cleanCoupon(raw,now=Math.floor(Date.now()/1000)){
  const coupon={
    id:String(raw?.id||''),
    title:texto(raw?.title,120),
    min_text:texto(raw?.min_text,60),
    cap_text:texto(raw?.cap_text,60),
    min_value:reais(raw?.min_value),
    cap_value:reais(raw?.cap_value),
    starts_at:momento(raw?.starts_at),
    expires_at:momento(raw?.expires_at),
    group:texto(raw?.group,30),
  };
  if(!CAMPANHA.test(coupon.id)||!coupon.title||!/OFF/i.test(coupon.title)) return null;
  if(coupon.expires_at&&coupon.expires_at<=now) return null;
  return coupon;
}

async function ensureTable(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ml_coupons(id INTEGER PRIMARY KEY CHECK(id=1),coupons TEXT NOT NULL,captured_at INTEGER NOT NULL)').run();
}

export async function onRequestPost({request,env}){
  if(!await authorized(request,env.ML_LIST_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>MAX_REQUEST_BYTES) return json({error:'too_large'},413);
  let body;try{body=await readJsonLimited(request,MAX_REQUEST_BYTES);}catch(error){
    const tooLarge=error instanceof Error&&error.message==='too_large';
    return json({error:tooLarge?'too_large':'invalid_json'},tooLarge?413:400);
  }
  const raw=Array.isArray(body?.coupons)?body.coupons:[];
  if(!raw.length||raw.length>MAX_COUPONS) return json({error:'invalid_coupons'},400);
  const now=Math.floor(Date.now()/1000);
  const seen=new Set();
  const coupons=raw.map(c=>cleanCoupon(c,now)).filter(c=>c&&!seen.has(c.id)&&seen.add(c.id));
  if(!coupons.length) return json({error:'no_coupons'},422);
  await ensureTable(env);
  await env.DB.prepare('INSERT INTO ml_coupons(id,coupons,captured_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET coupons=excluded.coupons,captured_at=excluded.captured_at')
    .bind(JSON.stringify(coupons),now).run();
  return json({ok:true,coupons:coupons.length,captured_at:now},201);
}

export async function onRequestGet({request,env}){
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  await ensureTable(env);
  const row=await env.DB.prepare('SELECT coupons,captured_at FROM ml_coupons WHERE id=1').first();
  if(!row) return json({error:'not_found'},404);
  return json({captured_at:row.captured_at,coupons:JSON.parse(row.coupons||'[]')});
}
