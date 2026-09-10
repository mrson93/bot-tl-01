import {json} from '../_lib.js';

const ALLOWED=/^\/(?:$|oferta\/[^/?#]{1,200}$|cupons$|quedas-de-preco$|menores-precos$|mais-acessadas$|mais-vendidos$|categorias\/[^/?#]{1,80}$|lojas\/[^/?#]{1,80}$|faixas-de-preco\/(?:ate-50|de-50-a-100|de-100-a-200|acima-de-200)$)/;

function saoPauloDay() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

export async function onRequestPost({request,env}) {
  let data;
  try{data=await request.json();}catch{return json({error:'invalid_json'},400);}
  const path=String(data?.path||'').slice(0,220);
  if(!ALLOWED.test(path)) return json({error:'invalid_path'},400);
  await env.DB.prepare(`INSERT INTO page_views_daily(observed_on,path,quantity) VALUES(?,?,1)
    ON CONFLICT(observed_on,path) DO UPDATE SET quantity=quantity+1`).bind(saoPauloDay(),path).run();
  return json({ok:true},202);
}
