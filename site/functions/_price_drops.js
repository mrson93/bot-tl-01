import {SITE,footer,head,header,html,money,responseHtml} from './_site.js';
import {termometro,urlPermitida} from './_price_alerts.js';

// "Maiores quedas de hoje": produtos monitorados (canal e público) cujo preço
// caiu nas últimas 24 h. Nunca mostra quem monitora nem quantas pessoas.
export const QUEDA_MINIMA=0.05;
const BOT_ALERTAS='TaBaratoAlertaDePrecoBot';
const LOJA={mercadolivre:'Mercado Livre',shopee:'Shopee'};

// Preço de agora (leitura das últimas 6 h, com estoque) contra a última
// leitura entre 30 h e 20 h atrás (a coleta roda a cada 2 h).
export async function quedasDeHoje(env,now=Math.floor(Date.now()/1000),limite=10) {
  const {results=[]}=await env.DB.prepare(
    `SELECT p.id,p.loja,p.id_produto,p.nome,p.imagem,p.link_afiliado,x.agora,x.antes FROM (
       SELECT l.produto_id,
         (SELECT preco FROM monitor_leituras WHERE produto_id=l.produto_id ORDER BY lido_em DESC LIMIT 1) AS agora,
         (SELECT disponivel FROM monitor_leituras WHERE produto_id=l.produto_id ORDER BY lido_em DESC LIMIT 1) AS disponivel,
         (SELECT preco FROM monitor_leituras WHERE produto_id=l.produto_id AND disponivel=1 AND preco>0
            AND lido_em BETWEEN ?2 AND ?3 ORDER BY lido_em DESC LIMIT 1) AS antes
       FROM monitor_leituras l WHERE l.lido_em>=?1 GROUP BY l.produto_id) x
     JOIN monitor_produtos p ON p.id=x.produto_id
     WHERE x.disponivel=1 AND x.agora>0 AND x.antes>0 AND x.agora<=x.antes*(1-?4)
       AND p.nome IS NOT NULL AND p.link_afiliado IS NOT NULL AND p.loja IN ('mercadolivre','shopee')
     ORDER BY (x.antes-x.agora)/x.antes DESC LIMIT ?5`,
  ).bind(now-6*3600,now-30*3600,now-20*3600,QUEDA_MINIMA,Math.max(1,Math.min(20,limite))).all();
  const itens=results.map(r=>({...r,link:urlPermitida(r.link_afiliado),agora:Number(r.agora),antes:Number(r.antes),
    queda:Math.round((1-Number(r.agora)/Number(r.antes))*100)})).filter(r=>r.link);
  if(!itens.length) return [];
  const {results:dias=[]}=await env.DB.prepare(
    `SELECT produto_id,date(lido_em-10800,'unixepoch') AS dia,MIN(preco) AS preco FROM monitor_leituras
     WHERE produto_id IN (${itens.map(()=>'?').join(',')}) AND disponivel=1 AND preco>0 AND lido_em>=?
     GROUP BY produto_id,dia`,
  ).bind(...itens.map(i=>i.id),now-365*86400).all();
  const porProduto=new Map();
  for(const d of dias){
    if(!porProduto.has(Number(d.produto_id))) porProduto.set(Number(d.produto_id),[]);
    porProduto.get(Number(d.produto_id)).push(Number(d.preco));
  }
  return itens.map(i=>({id:i.id,loja:i.loja,id_produto:i.id_produto,nome:String(i.nome).slice(0,160),
    imagem:urlPermitida(i.imagem,['mlstatic.com','susercontent.com','shopee.com.br']),link:i.link,
    agora:i.agora,antes:i.antes,queda:i.queda,
    alerta:`https://t.me/${BOT_ALERTAS}?start=${i.loja==='mercadolivre'?'ml':'sp'}_${i.id_produto}`,
    termometro:termometro(i.agora,porProduto.get(Number(i.id))||[])}));
}

function cartao(item) {
  const selo=item.termometro&&item.termometro.nivel!=='aprendendo'?`<p class="analysis-chip">${item.termometro.emoji} ${html(item.termometro.texto)}</p>`:'';
  const foto=item.imagem?`<img src="${html(item.imagem)}" alt="${html(item.nome)}" loading="lazy">`:'';
  return `<article class="offer-card"><div class="offer-media"><span class="discount">−${item.queda}%</span>${foto}</div>`
    +`<div class="offer-body"><div class="card-kicker"><span class="source">${html(LOJA[item.loja]||item.loja)}</span><time>últimas 24 h</time></div>`
    +`${selo}<h3>${html(item.nome)}</h3><div class="card-price"><span class="price">${html(money(item.agora))}</span><span class="was">${html(money(item.antes))}</span></div>`
    +`<p class="card-store"><a class="store-link" href="${html(item.alerta)}" rel="nofollow">🔔 Criar alerta de preço</a></p>`
    +`<a class="buy" href="${html(item.link)}" rel="nofollow sponsored">Ver na loja ↗</a></div></article>`;
}

export async function paginaQuedasDeHoje(env,now=Math.floor(Date.now()/1000)) {
  const itens=await quedasDeHoje(env,now,10);
  const titulo='Maiores quedas de hoje';
  const descricao='Os produtos acompanhados a cada 2 horas pelo Tá Barato que mais baixaram de preço nas últimas 24 horas.';
  const canonical=`${SITE}/quedas-de-hoje`;
  const nav=`<nav class="insight-tabs" aria-label="Explorar histórico"><a href="/quedas-de-hoje" aria-current="page">Hoje</a><a href="/quedas-de-preco">Quedas</a><a href="/menores-precos">Menores preços</a><a href="/mais-acessadas">Mais acessadas</a><a href="/mais-vendidos">Mais vendidos</a></nav>`;
  const grade=itens.length?`<div class="offer-grid collection-grid">${itens.map(cartao).join('')}</div>`
    :'<div class="empty"><h2>Nenhuma queda forte hoje</h2><p>Nenhum produto acompanhado caiu pelo menos 5% nas últimas 24 horas. Os preços são lidos a cada 2 horas; volte mais tarde.</p></div>';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title:`${titulo} | Tá Barato`,description:descricao,canonical})}</head><body>${header('history')}<main class="collection-page"><a class="offer-back" href="/">← Todo o catálogo</a><div class="collection-heading"><p class="eyebrow">PREÇO DE HOJE</p><h1>${titulo}</h1><p>${html(descricao)} Comparamos o preço de agora com o de 24 horas atrás; 🟢🟡🔴 dizem se ele está baixo, na média ou alto em relação ao último ano.</p><strong>${itens.length} ${itens.length===1?'produto':'produtos'}</strong></div>${nav}${grade}</main>${footer()}</body></html>`,
  200,'public, max-age=300, stale-while-revalidate=900');
}
