import {authorized,json,readJsonLimited} from '../_lib.js';

// Monitor de preços: o bot (GitHub Actions) lê aqui os produtos ativos e o
// histórico diário, e grava as leituras, os posts e a fila da madrugada.
// Os comandos /add, /remover, /lista e /historico usam o mesmo D1 pelo painel.
const MAX_REQUEST_BYTES=200_000;
const MAX_LEITURAS=500;
const RETENCAO_DIAS=120;
const FUSO_BRASILIA=3*3600;
const HOSTS_LINK=['mercadolivre.com.br','mercadolivre.com','meli.la','amazon.com.br','amzn.to','go.canaltabarato.com.br'];
const HOSTS_IMAGEM=['mlstatic.com','media-amazon.com','ssl-images-amazon.com'];

function numero(valor) {
  const n=Number(valor);
  return Number.isFinite(n)?n:null;
}
function inteiro(valor) {
  const n=numero(valor);
  return n!==null&&Number.isInteger(n)&&n>0?n:null;
}
function texto(valor,limite) {
  const t=String(valor??'').replace(/\s+/g,' ').trim();
  return t?t.slice(0,limite):null;
}
function urlPermitida(valor,hosts) {
  try {
    const url=new URL(String(valor||''));
    if(url.protocol!=='https:') return null;
    const host=url.hostname.toLowerCase();
    return hosts.some(h=>host===h||host.endsWith(`.${h}`))?url.toString().slice(0,2000):null;
  } catch { return null; }
}

export async function onRequestGet({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  const params=new URL(request.url).searchParams;
  const dias=Math.min(RETENCAO_DIAS,Math.max(1,inteiro(params.get('dias'))||90));
  const agora=Math.floor(Date.now()/1000);
  const inicio=agora-dias*86400;
  const desde=inteiro(params.get('posts_desde'))||(agora-86400);
  const [produtos,diario,primeira,ultimo,hoje,fila]=await env.DB.batch([
    env.DB.prepare('SELECT id,loja,id_produto,tipo,nome,categoria,link_afiliado,imagem FROM monitor_produtos WHERE ativo=1 ORDER BY id'),
    env.DB.prepare(
      `SELECT l.produto_id,date(l.lido_em-${FUSO_BRASILIA},'unixepoch') AS dia,MIN(l.preco) AS preco
       FROM monitor_leituras l JOIN monitor_produtos p ON p.id=l.produto_id AND p.ativo=1
       WHERE l.lido_em>=? AND l.disponivel=1 AND l.preco>0
       GROUP BY l.produto_id,dia ORDER BY l.produto_id,dia`).bind(inicio),
    env.DB.prepare('SELECT produto_id,MIN(lido_em) AS lido_em FROM monitor_leituras GROUP BY produto_id'),
    env.DB.prepare('SELECT produto_id,preco,MAX(postado_em) AS postado_em FROM monitor_posts GROUP BY produto_id'),
    env.DB.prepare('SELECT COUNT(*) AS total FROM monitor_posts WHERE postado_em>=?').bind(desde),
    env.DB.prepare('SELECT produto_id,preco,entrou_em FROM monitor_fila ORDER BY entrou_em'),
  ]);
  const historico={};
  for(const linha of diario.results||[]) (historico[linha.produto_id]||=[]).push([linha.dia,linha.preco]);
  const porProduto=(resultado,campo)=>Object.fromEntries((resultado.results||[]).map(l=>[l.produto_id,campo(l)]));
  return json({
    agora,
    produtos:produtos.results||[],
    historico,
    primeira_leitura:porProduto(primeira,l=>l.lido_em),
    ultimo_post:porProduto(ultimo,l=>({preco:l.preco,postado_em:l.postado_em})),
    posts_hoje:Number(hoje.results?.[0]?.total||0),
    fila:fila.results||[],
  });
}

export async function onRequestPost({request,env}) {
  if(!await authorized(request,env.PUBLISH_TOKEN)) return json({error:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length')||0)>MAX_REQUEST_BYTES) return json({error:'too_large'},413);
  let body;
  try { body=await readJsonLimited(request,MAX_REQUEST_BYTES); }
  catch { return json({error:'invalid_json'},400); }
  const agora=Math.floor(Date.now()/1000);
  const comandos=[];

  const leituras=Array.isArray(body?.leituras)?body.leituras:[];
  if(leituras.length>MAX_LEITURAS) return json({error:'too_many'},413);
  for(const leitura of leituras) {
    const produto=inteiro(leitura?.produto_id);
    if(!produto) return json({error:'invalid_reading'},400);
    const preco=numero(leitura.preco), antigo=numero(leitura.preco_antigo);
    comandos.push(env.DB.prepare(
      'INSERT INTO monitor_leituras(produto_id,preco,preco_antigo,disponivel,lido_em) VALUES(?,?,?,?,?)'
    ).bind(produto,preco>0?preco:null,antigo>0?antigo:null,leitura.disponivel?1:0,agora));
  }
  if(leituras.length) comandos.push(env.DB.prepare('DELETE FROM monitor_leituras WHERE lido_em<?').bind(agora-RETENCAO_DIAS*86400));

  for(const dados of Array.isArray(body?.produtos)?body.produtos.slice(0,200):[]) {
    const id=inteiro(dados?.id);
    if(!id) return json({error:'invalid_product'},400);
    comandos.push(env.DB.prepare(
      'UPDATE monitor_produtos SET nome=COALESCE(?,nome),categoria=COALESCE(?,categoria),link_afiliado=COALESCE(?,link_afiliado),imagem=COALESCE(?,imagem) WHERE id=?'
    ).bind(texto(dados.nome,300),texto(dados.categoria,120),urlPermitida(dados.link_afiliado,HOSTS_LINK),urlPermitida(dados.imagem,HOSTS_IMAGEM),id));
  }

  if(body?.post) {
    const produto=inteiro(body.post.produto_id), preco=numero(body.post.preco);
    if(!produto||!(preco>0)) return json({error:'invalid_post'},400);
    comandos.push(env.DB.prepare('INSERT INTO monitor_posts(produto_id,preco,motivo,postado_em) VALUES(?,?,?,?)')
      .bind(produto,preco,texto(body.post.motivo,40)||'oferta',agora));
    comandos.push(env.DB.prepare('DELETE FROM monitor_fila WHERE produto_id=?').bind(produto));
  }
  for(const item of Array.isArray(body?.fila_add)?body.fila_add.slice(0,200):[]) {
    const produto=inteiro(item?.produto_id), preco=numero(item?.preco);
    if(!produto||!(preco>0)) return json({error:'invalid_queue'},400);
    comandos.push(env.DB.prepare(
      'INSERT INTO monitor_fila(produto_id,preco,entrou_em) VALUES(?,?,?) ON CONFLICT(produto_id) DO UPDATE SET preco=excluded.preco'
    ).bind(produto,preco,agora));
  }
  for(const valor of Array.isArray(body?.fila_remover)?body.fila_remover.slice(0,200):[]) {
    const produto=inteiro(valor);
    if(!produto) return json({error:'invalid_queue'},400);
    comandos.push(env.DB.prepare('DELETE FROM monitor_fila WHERE produto_id=?').bind(produto));
  }
  if(!comandos.length) return json({ok:true,gravados:0});
  await env.DB.batch(comandos);
  return json({ok:true,gravados:comandos.length},201);
}
