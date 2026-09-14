import {json} from '../_lib.js';

const ALLOWED=/^\/(?:$|stories$|oferta\/[^/?#]{1,200}$|cupons$|quedas-de-preco$|menores-precos$|mais-acessadas$|mais-vendidos$|categorias\/[^/?#]{1,80}$|lojas\/[^/?#]{1,80}$|faixas-de-preco\/(?:ate-50|de-50-a-100|de-100-a-200|acima-de-200)$)/;
const SOURCES=new Set(['facebook','instagram','telegram','bluesky','google','bing','direct','other']);

function saoPauloDay() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

export async function onRequestPost({request,env}) {
  let data;
  try{data=await request.json();}catch{return json({error:'invalid_json'},400);}
  const path=String(data?.path||'').slice(0,220);
  const source=SOURCES.has(String(data?.source||'').toLowerCase())?String(data.source).toLowerCase():'other';
  if(!ALLOWED.test(path)) return json({error:'invalid_path'},400);
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
