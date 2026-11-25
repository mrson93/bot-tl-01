import {authorized,json,readJsonLimited} from '../_lib.js';
import {statementsDoPreco} from '../_daily_prices.js';

// A extensão "Tá Barato · Mercado Livre" lê os mais vendidos no navegador do
// dono do canal (o Mercado Livre recusa preço de catálogo à API e pede
// verificação ao servidor do bot) e guarda aqui a lista. O bot usa essa cópia
// quando a API não traz ofertas.
const MAX_REQUEST_BYTES=1_000_000;
const MAX_ITEMS=600;
const MIN_ITEMS=5;
const ID=/^MLB\d{6,15}$/;
const CATEGORY=/^MLB\d{3,9}$/;

function httpsIn(value,suffix){
  try{
    const url=new URL(String(value||''));
    const host=url.hostname.toLowerCase();
    return url.protocol==='https:'&&!url.username&&!url.password&&(host===suffix||host.endsWith(`.${suffix}`))?url.href:null;
  }catch{return null;}
}

function price(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>0&&n<1_000_000?Math.round(n*100)/100:null;
}

export function cleanItem(raw){
  const item={
    id:String(raw?.id||''),
    product_id:ID.test(String(raw?.product_id||''))?String(raw.product_id):null,
    title:String(raw?.title||'').replace(/\s+/g,' ').trim().slice(0,300),
    price:price(raw?.price),
    original_price:price(raw?.original_price),
    image:httpsIn(raw?.image,'mlstatic.com'),
    url:httpsIn(raw?.url,'mercadolivre.com.br'),
    category:CATEGORY.test(String(raw?.category||''))?String(raw.category):null,
    position:Number.isInteger(raw?.position)&&raw.position>0&&raw.position<1000?raw.position:null,
    pix:raw?.pix===true,
  };
  if(item.original_price&&!(item.original_price>item.price)) item.original_price=null;
  if(!ID.test(item.id)||!item.title||!item.price||!item.image||!item.url) return null;
  return item;
}

// A cópia também confere o preço das ofertas do Mercado Livre já publicadas
// (a API não deixa mais o site reler o catálogo): mesmo preço, preço "de",
// rótulo do Pix, histórico do dia e "preço conferido" agora.
const LOTE_IDS=90;
export async function refreshPublished(env,items,now){
  const porId=new Map();
  for(const item of items){
    for(const id of [item.product_id,item.id]) if(id&&!porId.has(`mercadolivre_${id}`)) porId.set(`mercadolivre_${id}`,item);
  }
  const ids=[...porId.keys()];
  const existentes=[];
  for(let i=0;i<ids.length;i+=LOTE_IDS){
    const lote=ids.slice(i,i+LOTE_IDS);
    const {results=[]}=await env.DB.prepare(`SELECT id FROM offers WHERE id IN (${lote.map(()=>'?').join(',')})`).bind(...lote).all();
    existentes.push(...results.map(row=>row.id));
  }
  const statements=[];
  for(const id of existentes){
    const item=porId.get(id);
    const original=item.original_price&&item.original_price>item.price?item.original_price:null;
    const discount=original?Math.round((1-item.price/original)*1000)/10:0;
    statements.push(...statementsDoPreco(env,id,{preco:item.price,nota:null,vendas:null},now),
      env.DB.prepare('UPDATE offers SET original_price=?,discount=?,payment_label=? WHERE id=?')
        .bind(original,discount,item.pix?'Preço no Pix':null,id));
  }
  if(statements.length) await env.DB.batch(statements);
  return existentes.length;
}

async function ensureTable(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ml_list(id INTEGER PRIMARY KEY CHECK(id=1),items TEXT NOT NULL,categories TEXT NOT NULL,captured_at INTEGER NOT NULL)').run();
}

// Só a extensão grava, com um token que não serve para mais nada no site.
export async function onRequestPost({request,env}){
  if(!await authorized(request,env.ML_LIST_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>MAX_REQUEST_BYTES) return json({error:'too_large'},413);
  let body;try{body=await readJsonLimited(request,MAX_REQUEST_BYTES);}catch(error){
    const tooLarge=error instanceof Error&&error.message==='too_large';
    return json({error:tooLarge?'too_large':'invalid_json'},tooLarge?413:400);
  }
  const raw=Array.isArray(body?.items)?body.items:[];
  if(!raw.length||raw.length>MAX_ITEMS) return json({error:'invalid_items'},400);
  const seen=new Set();
  const items=raw.map(cleanItem).filter(item=>item&&!seen.has(item.id)&&seen.add(item.id));
  // Poucos produtos válidos = página de erro ou verificação: não troca a cópia boa.
  if(items.length<MIN_ITEMS) return json({error:'no_products'},422);
  const categories=(Array.isArray(body?.categories)?body.categories:[]).map(String).filter(c=>CATEGORY.test(c)).slice(0,20);
  const now=Math.floor(Date.now()/1000);
  await ensureTable(env);
  await env.DB.prepare(
    'INSERT INTO ml_list(id,items,categories,captured_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET items=excluded.items,categories=excluded.categories,captured_at=excluded.captured_at'
  ).bind(JSON.stringify(items),JSON.stringify(categories),now).run();
  const refreshed=await refreshPublished(env,items,now);
  return json({ok:true,items:items.length,refreshed,captured_at:now},201);
}

// O bot lê com o mesmo token que já usa para publicar no site.
export async function onRequestGet({request,env}){
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  await ensureTable(env);
  const row=await env.DB.prepare('SELECT items,categories,captured_at FROM ml_list WHERE id=1').first();
  if(!row) return json({error:'not_found'},404);
  return json({captured_at:row.captured_at,categories:JSON.parse(row.categories||'[]'),items:JSON.parse(row.items||'[]')});
}
