import {authorized,json,readJsonLimited} from '../_lib.js';
import {deliverPriceAlerts,expirePriceAlerts} from '../_price_alerts.js';
import {garantirConfiguracao} from '../_alert_bot_setup.js';
import {enviarResumos} from '../_weekly_summary.js';

// Monitor de preços: o bot (GitHub Actions) lê aqui os produtos ativos e o
// histórico diário, e grava as leituras, os posts e a fila da madrugada.
// Os comandos /add, /remover, /lista e /historico usam o mesmo D1 pelo painel.
// Também entram os produtos dos alertas de preço do bot público (canal=0):
// eles são lidos, mas só os do admin (canal=1) podem ir para o canal.
const MAX_REQUEST_BYTES=200_000;
const MAX_LEITURAS=500;
const RETENCAO_DIAS=400;
const DIAS_DETALHE=30; // depois disso fica só o menor preço de cada dia
const FUSO_BRASILIA=3*3600;
const HOSTS_LINK=['mercadolivre.com.br','mercadolivre.com','meli.la','amazon.com.br','amzn.to','shopee.com.br','shope.ee','go.canaltabarato.com.br','aliexpress.com'];
// Produto lido na coleta: do canal (admin) ou com alerta de preço ativo.
const MONITORADO='((p.ativo=1 AND p.canal=1) OR EXISTS(SELECT 1 FROM alerta_precos a WHERE a.produto_id=p.id AND a.ativo=1 AND a.expira_em>?1))';
const HOSTS_IMAGEM=['mlstatic.com','media-amazon.com','ssl-images-amazon.com','susercontent.com','shopee.com.br','alicdn.com','aliexpress-media.com'];

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
  const [produtos,diario,primeira,ultimo,hoje,fila,alertas,estoque]=await env.DB.batch([
    env.DB.prepare(`SELECT p.id,p.loja,p.id_produto,p.tipo,p.nome,p.categoria,p.link_afiliado,p.imagem,
       (p.ativo=1 AND p.canal=1) AS no_canal FROM monitor_produtos p WHERE ${MONITORADO} ORDER BY p.id`).bind(agora),
    env.DB.prepare(
      `SELECT l.produto_id,date(l.lido_em-${FUSO_BRASILIA},'unixepoch') AS dia,MIN(l.preco) AS preco
       FROM monitor_leituras l JOIN monitor_produtos p ON p.id=l.produto_id
       WHERE ${MONITORADO} AND l.lido_em>=?2 AND l.disponivel=1 AND l.preco>0
       GROUP BY l.produto_id,dia ORDER BY l.produto_id,dia`).bind(agora,inicio),
    env.DB.prepare('SELECT produto_id,MIN(lido_em) AS lido_em FROM monitor_leituras GROUP BY produto_id'),
    env.DB.prepare('SELECT produto_id,preco,MAX(postado_em) AS postado_em FROM monitor_posts GROUP BY produto_id'),
    env.DB.prepare('SELECT COUNT(*) AS total FROM monitor_posts WHERE postado_em>=?').bind(desde),
    env.DB.prepare('SELECT produto_id,preco,entrou_em FROM monitor_fila ORDER BY entrou_em'),
    // Sem o chat: a coleta só precisa saber o preço pedido e o último aviso.
    env.DB.prepare(`SELECT id,produto_id,preco_alvo,avisar_menor,queda_percent,preco_base,avisar_estoque,ultimo_aviso_em,ultimo_aviso_preco
       FROM alerta_precos WHERE ativo=1 AND expira_em>? ORDER BY id`).bind(agora),
    // Estoque da última leitura de cada produto, para o aviso "voltou ao estoque".
    env.DB.prepare(`SELECT l.produto_id,l.disponivel FROM monitor_leituras l
       JOIN (SELECT produto_id,MAX(lido_em) AS lido_em FROM monitor_leituras GROUP BY produto_id) u
         ON u.produto_id=l.produto_id AND u.lido_em=l.lido_em`),
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
    alertas:alertas.results||[],
    ultimo_estoque:porProduto(estoque||{},l=>l.disponivel),
  });
}

export async function onRequestPost({request,env,waitUntil}) {
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
  if(leituras.length){
    comandos.push(env.DB.prepare('DELETE FROM monitor_leituras WHERE lido_em<?').bind(agora-RETENCAO_DIAS*86400));
    // Uma vez por dia: leituras com mais de 30 dias viram uma por dia (o menor
    // preço com estoque), para guardar 1 ano sem o banco crescer demais.
    if(new Date(agora*1000).getUTCHours()===9){
      comandos.push(env.DB.prepare(
        `DELETE FROM monitor_leituras WHERE lido_em<?1 AND id NOT IN (
           SELECT id FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY produto_id,date(lido_em-${FUSO_BRASILIA},'unixepoch')
             ORDER BY disponivel DESC,preco ASC,id) AS ordem FROM monitor_leituras WHERE lido_em<?1) WHERE ordem=1)`,
      ).bind(agora-DIAS_DETALHE*86400));
    }
  }

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
  for(const base of Array.isArray(body?.bases)?body.bases.slice(0,500):[]){
    const alerta=inteiro(base?.alerta_id), preco=numero(base?.preco);
    if(alerta&&preco>0) comandos.push(env.DB.prepare('UPDATE alerta_precos SET preco_base=? WHERE id=? AND preco_base IS NULL').bind(preco,alerta));
  }
  if(comandos.length) await env.DB.batch(comandos);
  let avisos=0;
  if(Array.isArray(body?.avisos)){
    avisos=await deliverPriceAlerts(env,body.avisos,agora);
    const configurar=garantirConfiguracao(env).catch(error=>console.error(JSON.stringify({event:'alert_bot_setup',result:'failed',reason:String(error?.message||error).slice(0,80)})));
    if(typeof waitUntil==='function') waitUntil(configurar); else await configurar;
    const vencer=expirePriceAlerts(env,agora).catch(error=>console.error(JSON.stringify({event:'price_alert_expire',result:'failed',reason:String(error?.message||error).slice(0,80)})));
    if(typeof waitUntil==='function') waitUntil(vencer); else await vencer;
    const resumo=enviarResumos(env,agora).catch(error=>console.error(JSON.stringify({event:'resumo_semanal',result:'failed',reason:String(error?.message||error).slice(0,80)})));
    if(typeof waitUntil==='function') waitUntil(resumo); else await resumo;
  }
  if(!comandos.length&&!Array.isArray(body?.avisos)) return json({ok:true,gravados:0});
  return json({ok:true,gravados:comandos.length,avisos},201);
}
