import {authorized,json,readJsonLimited} from '../_lib.js';

// A extensão do navegador lê a lista de ideias da Amazon de um IP doméstico
// (a Amazon recusa o datacenter do GitHub com 503) e guarda aqui o HTML das
// páginas. O bot busca essa cópia antes de tentar a Amazon diretamente.
const MAX_REQUEST_BYTES=6_000_000;
const MAX_PAGE_BYTES=1_500_000;
const MAX_PAGES=10;
const LIST_ID=/^[A-Z0-9]{6,20}$/;

async function ensureTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS amazon_list_pages(list_id TEXT NOT NULL,idx INTEGER NOT NULL,html TEXT NOT NULL,captured_at INTEGER NOT NULL,PRIMARY KEY(list_id,idx))').run();
}

// Só a extensão grava, com um token que não serve para mais nada no site.
export async function onRequestPost({request,env}) {
  if(!await authorized(request,env.AMAZON_LIST_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>MAX_REQUEST_BYTES) return json({error:'too_large'},413);
  let body;try{body=await readJsonLimited(request,MAX_REQUEST_BYTES);}catch(error){
    const tooLarge=error instanceof Error&&error.message==='too_large';
    return json({error:tooLarge?'too_large':'invalid_json'},tooLarge?413:400);
  }
  const listId=String(body?.list_id||'');
  const pages=Array.isArray(body?.pages)?body.pages:[];
  if(!LIST_ID.test(listId)) return json({error:'invalid_list'},400);
  if(!pages.length||pages.length>MAX_PAGES
     ||pages.some(page=>typeof page!=='string'||!page||page.length>MAX_PAGE_BYTES)) {
    return json({error:'invalid_pages'},400);
  }
  // Uma página sem produto indica tela de erro ou captcha: não substitui a cópia boa.
  if(!pages[0].includes('single-product-item-link')) return json({error:'no_products'},422);
  const now=Math.floor(Date.now()/1000);
  await ensureTable(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM amazon_list_pages WHERE list_id=?').bind(listId),
    ...pages.map((html,idx)=>env.DB.prepare(
      'INSERT INTO amazon_list_pages(list_id,idx,html,captured_at) VALUES(?,?,?,?)'
    ).bind(listId,idx,html,now)),
  ]);
  return json({ok:true,pages:pages.length,captured_at:now},201);
}

// O bot lê com o mesmo token que já usa para publicar no site.
export async function onRequestGet({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  const listId=new URL(request.url).searchParams.get('list_id')||'';
  if(!LIST_ID.test(listId)) return json({error:'invalid_list'},400);
  await ensureTable(env);
  const {results=[]}=await env.DB.prepare(
    'SELECT html,captured_at FROM amazon_list_pages WHERE list_id=? ORDER BY idx'
  ).bind(listId).all();
  if(!results.length) return json({error:'not_found'},404);
  return json({list_id:listId,captured_at:results[0].captured_at,pages:results.map(row=>row.html)});
}
