import {html,money} from './_site.js';
import {termometro} from './_price_alerts.js';

// Busca pelo nome no bot público de alertas: catálogo do site (ofertas que o
// canal já postou: Mercado Livre, Shopee e AliExpress) + Shopee ao vivo pela API de
// afiliados, quando SHOPEE_APP_ID e SHOPEE_SECRET estão nos secrets do site.
// A busca do Mercado Livre exige o token que só a coleta (Python) guarda.
const SHOPEE_API='https://open-api.affiliate.shopee.com.br/graphql';
export const MAX_RESULTADOS=5;
const PREFIXO={mercadolivre:'ml',shopee:'sp',aliexpress:'ae'};
const LOJA={mercadolivre:'Mercado Livre',shopee:'Shopee',aliexpress:'AliExpress'};
export const PERGUNTA_BUSCA='🔎 Qual produto você procura?';

export function termoBusca(valor='') {
  const termo=String(valor).replace(/\s+/g,' ').trim();
  if(termo.length<2||termo.length>60||/https?:\/\//i.test(termo)) return '';
  return termo;
}

// A busca da Shopee é "solta" (devolve qualquer coisa parecida): só fica o
// produto cujo nome tem todas as palavras buscadas (plural simples vale).
const normal=t=>` ${String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()} `;
const CURTAS=new Set(['de','da','do','das','dos','e','com','para','pra','o','a']);
export function temTodasAsPalavras(nome,termo) {
  const texto=normal(nome);
  return normal(termo).trim().split(' ').filter(p=>p&&!CURTAS.has(p))
    .every(p=>texto.includes(` ${p} `)||texto.includes(` ${p}s `)||(p.endsWith('s')&&texto.includes(` ${p.slice(0,-1)} `)));
}

export function shopeeConfigurada(env) {
  return Boolean(env?.SHOPEE_APP_ID&&env?.SHOPEE_SECRET);
}

async function sha256(texto) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(texto)));
  return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Assinatura da Shopee: SHA256(AppId + Timestamp + Payload + Secret).
export async function shopeeGraphql(env,query,fetcher=fetch,now=Math.floor(Date.now()/1000)) {
  const payload=JSON.stringify({query});
  const assinatura=await sha256(`${env.SHOPEE_APP_ID}${now}${payload}${env.SHOPEE_SECRET}`);
  const resposta=await fetcher(SHOPEE_API,{method:'POST',body:payload,signal:AbortSignal.timeout(8000),headers:{
    'Content-Type':'application/json',
    Authorization:`SHA256 Credential=${env.SHOPEE_APP_ID}, Timestamp=${now}, Signature=${assinatura}`,
  }});
  if(!resposta.ok) throw new Error(`shopee_http_${resposta.status}`);
  const corpo=await resposta.json();
  if(corpo?.errors?.length) throw new Error('shopee_erro');
  return corpo?.data||{};
}

const CAMPOS='itemId shopId productName priceMin price ratingStar sales imageUrl offerLink';

function itemShopee(node) {
  const shop=String(node?.shopId||''), item=String(node?.itemId||'');
  const preco=Number(node?.priceMin||node?.price);
  if(!/^\d{1,15}$/.test(shop)||!/^\d{1,15}$/.test(item)||!(preco>0)) return null;
  return {loja:'shopee',id_produto:`${shop}_${item}`,nome:String(node.productName||'').slice(0,160),preco,
    vendas:Number(node.sales)||0,nota:Number(node.ratingStar)||0,imagem:node.imageUrl||null,
    link:/^https:\/\/([a-z0-9-]+\.)*shopee\.com\.br\//i.test(String(node.offerLink||''))?String(node.offerLink):null};
}

// filtrar=false: a comparação de lojas tem a própria regra de semelhança.
export async function buscarShopee(env,termo,fetcher=fetch,filtrar=true) {
  if(!shopeeConfigurada(env)) return [];
  try{
    const data=await shopeeGraphql(env,`{productOfferV2(keyword:${JSON.stringify(termo)},limit:20,page:1){nodes{${CAMPOS}}}}`,fetcher);
    return (data?.productOfferV2?.nodes||[]).map(itemShopee).filter(i=>i&&(!filtrar||temTodasAsPalavras(i.nome,termo)));
  }catch(error){
    console.error(JSON.stringify({event:'busca_shopee',result:'failed',reason:String(error?.message||error).slice(0,60)}));
    return [];
  }
}

// Link de afiliado da Shopee (subId "alerta") gerado pelo site, para quando a
// coleta não conseguiu gerar. Devolve o link curto ou null.
export async function gerarLinkShopee(env,idProduto,fetcher=fetch) {
  const achado=String(idProduto||'').match(/^(\d{1,15})_(\d{1,15})$/);
  if(!achado||!shopeeConfigurada(env)) return null;
  try{
    const origem=JSON.stringify(`https://shopee.com.br/product/${achado[1]}/${achado[2]}`);
    const data=await shopeeGraphql(env,`mutation{generateShortLink(input:{originUrl:${origem},subIds:["alerta"]}){shortLink}}`,fetcher);
    const link=String(data?.generateShortLink?.shortLink||'');
    return /^https:\/\/([a-z0-9-]+\.)*(shopee\.com\.br|shope\.ee)\//i.test(link)?link:null;
  }catch{ return null; }
}

// Um produto da Shopee pelo id, para o alerta já nascer com nome e preço.
export async function lerShopee(env,idProduto,fetcher=fetch) {
  const achado=String(idProduto||'').match(/^(\d{1,15})_(\d{1,15})$/);
  if(!achado||!shopeeConfigurada(env)) return null;
  try{
    const data=await shopeeGraphql(env,`{productOfferV2(shopId:${achado[1]},itemId:${achado[2]},limit:1,page:1){nodes{${CAMPOS}}}}`,fetcher);
    return itemShopee(data?.productOfferV2?.nodes?.[0]);
  }catch{ return null; }
}

function termosLike(termo) {
  return termo.split(' ').filter(Boolean).slice(0,6).map(t=>`%${t.replace(/[\\%_]/g,'\\$&')}%`);
}

async function buscarCatalogo(env,termo) {
  const termos=termosLike(termo);
  if(!termos.length) return [];
  const {results=[]}=await env.DB.prepare(
    `SELECT id,title,price,rating,sales,image_url FROM offers
     WHERE availability!='unavailable' AND price>0 AND (id LIKE 'mercadolivre\\_%' ESCAPE '\\' OR id LIKE 'shopee\\_%' ESCAPE '\\' OR id LIKE 'aliexpress\\_%' ESCAPE '\\')
       AND ${termos.map(()=>"title LIKE ? ESCAPE '\\' COLLATE NOCASE").join(' AND ')}
     ORDER BY COALESCE(sales,0) DESC,COALESCE(cataloged_at,published_at) DESC LIMIT 10`,
  ).bind(...termos).all();
  return results.map(r=>{
    const [,loja,id]=String(r.id).match(/^(mercadolivre|shopee|aliexpress)_(.+)$/)||[];
    const valido=loja==='mercadolivre'?/^MLB\d+$/i.test(id):loja==='aliexpress'?/^\d{6,20}$/.test(id):/^\d+_\d+$/.test(id||'');
    return valido?{loja,id_produto:loja==='mercadolivre'?id.toUpperCase():id,nome:String(r.title||'').slice(0,160),
      preco:Number(r.price),vendas:Number(r.sales)||0,nota:Number(r.rating)||0,imagem:r.image_url||null,
      link:`https://canaltabarato.com.br/go/${encodeURIComponent(r.id)}`}:null;
  }).filter(Boolean);
}

// Produtos que já acompanhamos: há quantos dias e o termômetro do preço.
async function historicoDosResultados(env,itens,now) {
  if(!itens.length) return new Map();
  const condicoes=itens.map(()=>'(p.loja=? AND p.id_produto=?)').join(' OR ');
  const {results=[]}=await env.DB.prepare(
    `SELECT p.loja,p.id_produto,date(l.lido_em-10800,'unixepoch') AS dia,MIN(l.preco) AS preco,MIN(l.lido_em) AS desde
     FROM monitor_produtos p JOIN monitor_leituras l ON l.produto_id=p.id
     WHERE (${condicoes}) AND l.disponivel=1 AND l.preco>0 AND l.lido_em>=? GROUP BY p.id,dia`,
  ).bind(...itens.flatMap(i=>[i.loja,i.id_produto]),now-365*86400).all();
  const mapa=new Map();
  for(const r of results){
    const chave=`${r.loja}:${r.id_produto}`;
    const atual=mapa.get(chave)||{valores:[],desde:Infinity};
    atual.valores.push(Number(r.preco)); atual.desde=Math.min(atual.desde,Number(r.desde));
    mapa.set(chave,atual);
  }
  return mapa;
}

// Até 3 do catálogo primeiro (já passaram pelo canal), Shopee ao vivo
// completa até 5, sem repetir produto.
export async function buscarProdutos(env,termo,fetcher=fetch,now=Math.floor(Date.now()/1000)) {
  const [catalogo,shopee]=await Promise.all([buscarCatalogo(env,termo),buscarShopee(env,termo,fetcher)]);
  const vistos=new Set(), itens=[];
  const juntar=(lista,limite)=>{for(const item of lista){
    const chave=`${item.loja}:${item.id_produto}`;
    if(itens.length>=limite) break;
    if(!vistos.has(chave)){vistos.add(chave);itens.push(item);}
  }};
  juntar(catalogo,3); juntar(shopee,MAX_RESULTADOS); juntar(catalogo,MAX_RESULTADOS);
  const historico=await historicoDosResultados(env,itens,now);
  return itens.map(item=>{
    const h=historico.get(`${item.loja}:${item.id_produto}`);
    return h?{...item,dias:Math.max(1,Math.round((now-h.desde)/86400)),termometro:termometro(item.preco,h.valores)}:item;
  });
}

const milhar=n=>n>=1000?`${(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})} mil`:String(n);

// Quando nada aparece nas lojas aceitas, mas o canal já postou na Amazon.
export async function amazonNoCatalogo(env,termo) {
  const termos=termosLike(termo);
  if(!termos.length) return null;
  try{
    const r=await env.DB.prepare(
      `SELECT id,title,price FROM offers WHERE availability!='unavailable' AND price>0 AND id LIKE 'amazon\\_%' ESCAPE '\\'
         AND ${termos.map(()=>"title LIKE ? ESCAPE '\\' COLLATE NOCASE").join(' AND ')} ORDER BY price ASC LIMIT 1`,
    ).bind(...termos).first();
    return r?{nome:String(r.title||'').slice(0,90),preco:Number(r.price),link:`https://canaltabarato.com.br/go/${encodeURIComponent(r.id)}`}:null;
  }catch{ return null; }
}

export function formatarResultados(termo,itens,palavra='',amazon=null) {
  const botaoPalavra=palavra?[[{text:`🔔 Avisar quando o canal postar "${palavra}"`.slice(0,64),callback_data:`k:${palavra}`}]]:[];
  if(!itens.length){
    const naAmazon=amazon?['',`O canal já postou na <b>Amazon</b>: ${html(amazon.nome)} por ${html(money(amazon.preco))}. A Amazon ainda não entra nos alertas de preço, mas dá para ver a oferta abaixo.`]:[];
    return {text:[`🔎 Não achei <b>${html(termo)}</b> no Mercado Livre, na Shopee nem no AliExpress.`,...naAmazon,'',
      'Tente com outras palavras (ex.: <code>air fryer</code>) ou cole o link do produto.'].join('\n'),
    markup:{inline_keyboard:[...(amazon?[[{text:'🛒 Ver na Amazon ↗',url:amazon.link}]]:[]),...botaoPalavra,[{text:'🔎 Nova busca',callback_data:'bn'}]]}};
  }
  const linhas=[`🔎 <b>Resultados para "${html(termo)}"</b>`,''];
  itens.forEach((item,i)=>{
    const detalhes=[`💰 ${html(money(item.preco))}`,LOJA[item.loja]];
    if(item.nota>=1) detalhes.push(`⭐ ${item.nota.toLocaleString('pt-BR',{maximumFractionDigits:1})}`);
    if(item.vendas>0) detalhes.push(`${milhar(item.vendas)} vendidos`);
    linhas.push(`<b>${i+1}.</b> ${html(item.nome||'Produto')}`,`    ${detalhes.join(' · ')}`);
    if(item.dias){
      const selo=item.termometro&&item.termometro.nivel!=='aprendendo'?` · ${item.termometro.emoji} ${item.termometro.texto.split(':')[0]}`:'';
      linhas.push(`    📈 Acompanhado há ${item.dias} dia(s)${selo}`);
    }
    linhas.push('');
  });
  linhas.push('Toque no número para criar o alerta. <i>Preços da última leitura; podem mudar.</i>');
  const numeros=itens.map((item,i)=>({text:`${i+1}`,callback_data:`b:${PREFIXO[item.loja]}:${item.id_produto}`}));
  return {text:linhas.join('\n'),markup:{inline_keyboard:[numeros,...botaoPalavra,[{text:'🔎 Nova busca',callback_data:'bn'}]]}};
}

export function perguntaBusca() {
  return {text:`${PERGUNTA_BUSCA}\nDigite o nome, por exemplo: <code>air fryer mondial</code>`,
    markup:{force_reply:true,input_field_placeholder:'Ex.: air fryer mondial'}};
}
