import {SITE,html,money} from './_site.js';
import {buscarShopee} from './_product_search.js';

// Comparar lojas: procura o mesmo produto pelo nome nas outras lojas (catálogo
// do site e Shopee ao vivo) e mostra a opção mais barata como SUGESTÃO, porque
// o nome parecido não garante o mesmo modelo. Resultado guardado por 12 h em
// monitor_produtos.comparacao (JSON) para não buscar a cada toque.
export const VALIDADE_COMPARACAO=12*3600;
const SEMELHANCA_MINIMA=0.75;
const LOJA={mercadolivre:'Mercado Livre',shopee:'Shopee',aliexpress:'AliExpress',amazon:'Amazon'};
const NA_LOJA={mercadolivre:'no Mercado Livre',shopee:'na Shopee',aliexpress:'no AliExpress',amazon:'na Amazon'};
const FONTE={'Mercado Livre':'mercadolivre',Shopee:'shopee',AliExpress:'aliexpress',Amazon:'amazon'};
const VAZIAS=new Set(('de da do das dos com sem para por e em a o as os um uma kit original novo nova lancamento oferta promocao '
  +'frete gratis envio imediato pronta entrega brasil nacional unidade unidades pecas peca cor cores preto preta branco branca '
  +'azul rosa vermelho cinza verde top premium').split(' '));

export function normalizar(texto='') {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/(\d),(\d)/g,'$1.$2').replace(/[^a-z0-9.]+/g,' ').replace(/(^|\s)\.|\.(\s|$)/g,' ').trim();
}

// Palavras que identificam o produto (sem artigos, cores e propaganda), na ordem do nome.
export function palavrasChave(nome,limite=8) {
  const vistas=new Set();
  return normalizar(nome).split(' ').filter(p=>(p.length>=2||/\d/.test(p))&&!VAZIAS.has(p)&&!vistas.has(p)&&vistas.add(p)).slice(0,limite);
}

// Tudo que tem número (modelo, capacidade, quantidade: a36, 256gb, 36, 12000)
// tem que bater; e versões (Ultra, Pro, Max…) têm que ser as mesmas dos dois lados.
const temNumero=p=>/\d/.test(p);
const VARIANTES=new Set('ultra pro max plus mini lite fe se neo air slim'.split(' '));

export function semelhanca(nomeOrigem,nomeCandidato) {
  const origem=palavrasChave(nomeOrigem), todasCandidato=palavrasChave(nomeCandidato,40);
  const candidato=new Set(todasCandidato), todasOrigem=new Set(palavrasChave(nomeOrigem,40));
  if(origem.length<3) return 0;
  if(origem.filter(temNumero).some(p=>!candidato.has(p))) return 0;
  const variantes=lista=>[...lista].filter(p=>VARIANTES.has(p)).sort().join(' ');
  if(variantes(todasOrigem)!==variantes(candidato)) return 0;
  const iguais=origem.filter(p=>candidato.has(p)).length;
  return iguais>=3?iguais/origem.length:0;
}

async function candidatosDoCatalogo(env,produto,palavras) {
  // As 3 palavras mais longas filtram bem sem perder o produto.
  const termos=[...palavras].sort((a,b)=>b.length-a.length).slice(0,3).map(p=>`%${p.replace(/[\\%_]/g,'\\$&')}%`);
  if(termos.length<2) return [];
  // Com a categoria, a busca lê só as ofertas dela (índice), e não o catálogo
  // inteiro: era a consulta que mais gastava a cota diária do D1.
  const categoria=produto.categoria&&produto.categoria!=='outros'?produto.categoria:null;
  const {results=[]}=await env.DB.prepare(
    `SELECT id,title,price,source FROM offers WHERE ${categoria?'category=? AND ':''}availability!='unavailable' AND price>0 AND id<>?
       AND ${termos.map(()=>"title LIKE ? ESCAPE '\\' COLLATE NOCASE").join(' AND ')}
     ORDER BY price ASC LIMIT 20`,
  ).bind(...(categoria?[categoria]:[]),`${produto.loja}_${produto.id_produto}`,...termos).all();
  return results.map(r=>({loja:FONTE[r.source],nome:String(r.title||''),preco:Number(r.price),
    link:`${SITE}/go/${encodeURIComponent(r.id)}`})).filter(c=>c.loja&&c.loja!==produto.loja);
}

// Melhor opção mais barata em outra loja, ou null. Não guarda nada.
export async function procurarEmOutrasLojas(env,produto,precoAtual,fetcher=fetch) {
  const palavras=palavrasChave(produto?.nome);
  if(palavras.length<2||!(precoAtual>0)) return null;
  const [catalogo,shopee]=await Promise.all([
    candidatosDoCatalogo(env,produto,palavras).catch(()=>[]),
    produto.loja==='shopee'?[]:buscarShopee(env,palavras.slice(0,5).join(' '),fetcher,false)
      .then(itens=>itens.filter(i=>i.link).map(i=>({loja:'shopee',nome:i.nome,preco:i.preco,link:i.link}))),
  ]);
  const validos=[...catalogo,...shopee].filter(c=>c.preco>=precoAtual*0.5&&c.preco<=precoAtual*1.5
    &&semelhanca(produto.nome,c.nome)>=SEMELHANCA_MINIMA);
  validos.sort((a,b)=>a.preco-b.preco);
  const melhor=validos[0];
  return melhor?{loja:melhor.loja,nome:melhor.nome.slice(0,120),preco:melhor.preco,link:melhor.link}:null;
}

// Usa o resultado guardado se tiver menos de 12 h; senão procura e guarda
// (inclusive "nada encontrado", para não repetir a busca a cada toque).
// buscar=false: só o que estiver guardado e válido (a entrega de avisos limita as buscas novas).
export async function comparacao(env,produto,precoAtual,now=Math.floor(Date.now()/1000),fetcher=fetch,buscar=true) {
  if(!produto?.produto_id&&!produto?.id) return null;
  const id=produto.produto_id||produto.id;
  if(Number(produto.comparado_em)>now-VALIDADE_COMPARACAO){
    try{ return produto.comparacao?JSON.parse(produto.comparacao):null; }catch{ return null; }
  }
  if(!buscar) return null;
  let achado=null;
  try{ achado=await procurarEmOutrasLojas(env,produto,precoAtual,fetcher); }
  catch(error){
    console.error(JSON.stringify({event:'comparar_lojas',result:'failed',reason:String(error?.message||error).slice(0,60)}));
    return null;
  }
  try{
    await env.DB.prepare('UPDATE monitor_produtos SET comparacao=?,comparado_em=? WHERE id=?')
      .bind(achado?JSON.stringify(achado):null,now,id).run();
  }catch{ /* sem cache, a sugestão vale do mesmo jeito */ }
  return achado;
}

// Só vale mostrar se a outra loja estiver pelo menos 2% mais barata agora.
export function sugestaoMaisBarata(achado,precoAtual) {
  if(!achado||!(precoAtual>0)||!(achado.preco<precoAtual*0.98)) return null;
  const economia=Math.round((1-achado.preco/precoAtual)*100);
  return {
    linha:`💡 Parecido ${NA_LOJA[achado.loja]||'em outra loja'} por <b>${html(money(achado.preco))}</b> (${economia}% menos). Confira se é o mesmo modelo.`,
    botao:{text:`💡 Ver ${NA_LOJA[achado.loja]||'na outra loja'} ↗`,url:achado.link},
  };
}

export const nomeDaLoja=loja=>LOJA[loja]||loja;

// Página da oferta: o mesmo produto em outras lojas do catálogo do site (sem
// chamar API externa a cada visita). O mais barato de cada loja, até 4 lojas.
export async function outrasLojasNoCatalogo(env,offer) {
  const loja=FONTE[offer?.source], preco=Number(offer?.price);
  const idProduto=String(offer?.id||'').replace(/^[a-z]+_/,'');
  const palavras=palavrasChave(offer?.title);
  if(!loja||!(preco>0)||palavras.length<3) return [];
  const candidatos=await candidatosDoCatalogo(env,{loja,id_produto:idProduto,nome:offer.title,categoria:offer.category},palavras).catch(()=>[]);
  const porLoja=new Map();
  for(const c of candidatos){
    if(!(c.preco>=preco*0.5&&c.preco<=preco*1.5)||semelhanca(offer.title,c.nome)<SEMELHANCA_MINIMA) continue;
    const atual=porLoja.get(c.loja);
    if(!atual||c.preco<atual.preco) porLoja.set(c.loja,{...c,lojaNome:LOJA[c.loja]});
  }
  return [...porLoja.values()].sort((a,b)=>a.preco-b.preco).slice(0,4);
}
