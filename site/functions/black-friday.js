import {BLACK_FRIDAY,SITE,footer,head,header,html,offerCard,offerPath,responseHead,responseHtml} from './_site.js';
import {discoveryRows} from './_discovery.js';
import {couponCard} from './cupons.js';

// Página da Black Friday: ofertas com o selo da própria loja, maiores quedas da
// semana, menores preços já vistos e cupons ativos, com filtro por loja (link,
// sem formulário). Fica no ar o ano todo; o menu só a mostra na temporada.
const LOJAS=[['','Todas'],['mercado-livre','Mercado Livre'],['shopee','Shopee'],['amazon','Amazon'],['aliexpress','AliExpress']];
const BOT='TaBaratoAlertaDePrecoBot';
export {emTemporada} from './_site.js';
const diaBrasilia=now=>new Date((now-3*3600)*1000).toISOString().slice(0,10);
const diasEntre=(a,b)=>Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000);


export function situacao(now=Math.floor(Date.now()/1000)) {
  const hoje=diaBrasilia(now);
  if(hoje<BLACK_FRIDAY.dia){
    const faltam=diasEntre(hoje,BLACK_FRIDAY.dia);
    return {fase:'antes',texto:faltam===1?'Falta 1 dia':`Faltam ${faltam} dias`};
  }
  if(hoje<=BLACK_FRIDAY.fim) return {fase:'agora',texto:hoje===BLACK_FRIDAY.dia?'É hoje!':'Acontecendo agora (vai até a Cyber Monday, 1/12)'};
  return {fase:'depois',texto:'Black Friday 2026 encerrada'};
}

function secao(titulo,descricao,rows,vazio) {
  return `<section class="bf-section"><div class="bf-section-head"><h2>${titulo}</h2><p>${html(descricao)}</p></div>${rows.length
    ?`<div class="offer-grid collection-grid">${rows.map(offerCard).join('')}</div>`:`<p class="bf-empty">${html(vazio)}</p>`}</section>`;
}

export async function dadosBlackFriday(env,loja,now=Math.floor(Date.now()/1000)) {
  const nomeLoja=(LOJAS.find(([slug])=>slug===loja)||LOJAS[0])[1];
  const daLoja=o=>!loja||o.source===nomeLoja;
  const [selo,quedas,menores,cupons]=await Promise.all([
    env.DB.prepare(`SELECT * FROM offers WHERE campaign='black_friday' AND campaign_at>=? AND availability!='unavailable'
      ${loja?'AND source=?':''} ORDER BY discount DESC,campaign_at DESC LIMIT 24`).bind(...(loja?[now-14*86400,nomeLoja]:[now-14*86400])).all()
      .then(r=>r.results||[]).catch(()=>[]),
    discoveryRows(env,'drops',100,now).catch(()=>[]),
    discoveryRows(env,'lows',100,now).catch(()=>[]),
    env.DB.prepare(`SELECT id,source,code,title,kind,condition,expires_at FROM coupons
      WHERE (active_at IS NULL OR active_at<=?1) AND (expires_at IS NULL OR expires_at>?1) ORDER BY expires_at LIMIT 6`)
      .bind(now).all().then(r=>r.results||[]).catch(()=>[]),
  ]);
  return {nomeLoja,selo,quedas:quedas.filter(daLoja).slice(0,12),menores:menores.filter(daLoja).slice(0,12),
    cupons:cupons.filter(c=>!loja||c.source===nomeLoja)};
}

export async function paginaBlackFriday(env,loja='',now=Math.floor(Date.now()/1000)) {
  const d=await dadosBlackFriday(env,loja,now);
  const s=situacao(now);
  const canonical=`${SITE}/black-friday`;
  const title='Black Friday 2026: ofertas com preço conferido | Tá Barato';
  const description='Black Friday 2026 sem desconto falso: ofertas com o selo da loja, maiores quedas da semana e produtos no menor preço que já vimos. Mercado Livre, Shopee, Amazon e AliExpress.';
  const filtro=LOJAS.map(([slug,nome])=>`<a href="/black-friday${slug?`?loja=${slug}`:''}"${slug===loja?' aria-current="page"':''}>${html(nome)}</a>`).join('');
  const todos=[...d.selo,...d.quedas,...d.menores];
  const structured=JSON.stringify({'@context':'https://schema.org','@type':'CollectionPage',name:'Black Friday 2026 no Tá Barato',description,url:canonical,
    mainEntity:{'@type':'ItemList',itemListElement:todos.slice(0,30).map((o,i)=>({'@type':'ListItem',position:i+1,url:`${SITE}${offerPath(o)}`}))}}).replace(/</g,'\\u003c');
  const cupons=d.cupons.length?`<section class="bf-section"><div class="bf-section-head"><h2>🎟 Cupons ativos</h2><p>Cupons oficiais das lojas, com prazo. Copie e aplique no carrinho.</p></div><div class="coupon-grid">${d.cupons.map(couponCard).join('')}</div></section>`:'';
  return responseHtml(`<!doctype html><html lang="pt-BR"><head>${head({title,description,canonical,structured})}</head><body>${header('black')}<main class="bf-page">
<section class="bf-hero"><p class="bf-date">🖤 BLACK FRIDAY 2026 · SEXTA, 27/11</p><h1>Só desconto de verdade.</h1><p class="bf-lead">A gente confere o preço de antes. Se subiu para depois “cair”, você fica sabendo.</p><span class="bf-status bf-${s.fase}">${html(s.texto)}</span></section>
<nav class="bf-filter" aria-label="Filtrar por loja">${filtro}</nav>
${secao('🖤 Selo Black Friday da loja',`Ofertas que a própria loja marcou como Black Friday${loja?` · ${d.nomeLoja}`:''}.`,d.selo,'As lojas ainda não marcaram ofertas como Black Friday aqui. Elas entram assim que aparecem.')}
${secao('📉 Maiores quedas da semana','Produtos que ficaram mais baratos do que estavam na medição anterior.',d.quedas,'Nenhuma queda registrada nesta semana para este filtro.')}
${secao('◎ No menor preço que já vimos','O preço de agora é o menor do nosso histórico para o produto.',d.menores,'Nenhum produto no menor preço do histórico para este filtro.')}
${cupons}
<section class="bf-tips"><h2>Como não cair em desconto falso</h2><ol>
<li><strong>Desconfie do “de R$ 999 por R$ 499”.</strong> O preço riscado é a loja que escolhe.</li>
<li><strong>Olhe o histórico.</strong> Se o preço subiu nas últimas semanas, o desconto é menor do que parece.</li>
<li><strong>Crie o alerta antes.</strong> Assim você compra quando cair de verdade, sem ficar atualizando a página.</li></ol></section>
<section class="bf-alert"><div><h2>Já sabe o que quer?</h2><p>Coloque na lista agora e a gente avisa no Telegram quando cair. O aviso diz se o preço subiu antes.</p></div><a href="https://t.me/${BOT}?start=black_friday" target="_blank" rel="noopener noreferrer">🔔 Criar alerta de preço</a></section>
</main>${footer()}</body></html>`,200,'public, max-age=300, stale-while-revalidate=600');
}

export function onRequestGet({request,env}) {
  const loja=new URL(request.url).searchParams.get('loja')||'';
  return paginaBlackFriday(env,LOJAS.some(([slug])=>slug===loja)?loja:'');
}

export async function onRequestHead(context) {
  return responseHead(await onRequestGet(context));
}
