import {SITE,footer,head,header,html,offerCard,offerPath,responseHead,responseHtml} from './_site.js';
import {discoveryRows} from './_discovery.js';
import {blogCard} from './_blog.js';

// Pilar "Preços": uma página com abas (link, sem formulário) em vez de quatro
// páginas soltas. As páginas antigas continuam no ar para o Google.
export const ABAS=[
  ['caiu','📉 Caiu hoje','Produtos que ficaram mais baratos na medição mais recente.'],
  ['menor','◎ Menor preço','O preço de agora é o menor que já registramos para o produto.'],
  ['guias','📚 Guias','Comparativos e guias para escolher antes de comprar.'],
];

async function conteudo(env,aba,now) {
  if(aba==='guias'){
    const rows=await env.DB.prepare(`SELECT slug,title,excerpt,cover_image_url,category,published_at FROM blog_posts
      WHERE status='published' AND published_at<=? ORDER BY published_at DESC LIMIT 24`).bind(now).all().then(r=>r.results||[]).catch(()=>[]);
    return {itens:rows,html:rows.length?`<div class="blog-grid">${rows.map(blogCard).join('')}</div>`:'<p class="bf-empty">Os primeiros guias estão sendo preparados.</p>',mais:'/blog'};
  }
  const rows=await discoveryRows(env,aba==='menor'?'lows':'drops',48,now).catch(()=>[]);
  return {itens:rows,html:rows.length?`<div class="offer-grid collection-grid">${rows.map(offerCard).join('')}</div>`
    :`<p class="bf-empty">${aba==='menor'?'Nenhum produto no menor preço do histórico agora.':'Nenhuma queda registrada nas últimas horas. Volte daqui a pouco.'}</p>`,
    mais:aba==='menor'?'/menores-precos':'/quedas-de-preco'};
}

export async function paginaPrecos(env,abaPedida='',now=Math.floor(Date.now()/1000)) {
  const aba=ABAS.some(([chave])=>chave===abaPedida)?abaPedida:'caiu';
  const [,nome,descricao]=ABAS.find(([chave])=>chave===aba);
  const c=await conteudo(env,aba,now);
  const canonical=`${SITE}/precos${aba==='caiu'?'':`?aba=${aba}`}`;
  const title='Preços: o que caiu hoje e o menor preço já visto | Tá Barato';
  const description='Veja o que ficou mais barato hoje, os produtos no menor preço do histórico e guias para escolher antes de comprar.';
  const structured=aba==='guias'?'':JSON.stringify({'@context':'https://schema.org','@type':'CollectionPage',name:`Preços · ${nome}`,description,url:canonical,
    mainEntity:{'@type':'ItemList',itemListElement:c.itens.slice(0,30).map((o,i)=>({'@type':'ListItem',position:i+1,url:`${SITE}${offerPath(o)}`}))}}).replace(/</g,'\\u003c');
  const abas=ABAS.map(([chave,rotulo])=>`<a role="tab" href="/precos${chave==='caiu'?'':`?aba=${chave}`}"${chave===aba?' aria-selected="true" aria-current="page"':' aria-selected="false"'}>${rotulo}</a>`).join('');
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical,structured})}</head><body>${header('prices')}<main class="collection-page prices-page">
<div class="collection-heading"><p class="eyebrow">PREÇOS</p><h1>Saiba se o preço é bom antes de comprar.</h1></div>
<nav class="prices-tabs" role="tablist" aria-label="Seções de preços">${abas}</nav>
<p class="prices-desc">${html(descricao)}</p>
${c.html}
<p class="prices-more"><a href="${c.mais}">Ver a lista completa →</a></p>
</main>${footer()}</body></html>`,200,'public, max-age=300, stale-while-revalidate=600');
}

export function onRequestGet({request,env}) {
  return paginaPrecos(env,new URL(request.url).searchParams.get('aba')||'');
}

export async function onRequestHead(context) {
  return responseHead(await onRequestGet(context));
}
