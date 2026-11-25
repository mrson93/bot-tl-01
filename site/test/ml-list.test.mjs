import assert from 'node:assert/strict';
import test from 'node:test';
import {cleanItem,onRequestGet,onRequestPost,refreshPublished} from '../functions/api/ml-list.js';
import {extrairObjeto,lerPagina,pediuVerificacao} from '../../extensao-mercadolivre/leitura.js';
import {categoriasDaRodada} from '../../extensao-mercadolivre/fundo.js';

// --- Extensão: leitura da página "Mais vendidos" ---

const cartao=(id,titulo,atual,anterior,extra={})=>({
  components:[
    {type:'title',title:{text:titulo}},
    {type:'seller'},
    {type:'price',price:{current_price:{value:atual,currency:'BRL'},discount_pct:10,
      discount_complement:{text:'{discount_complement}',values:[{key:'discount_complement',type:'label',label:{text:'no Pix'}}]},
      price_labels:anterior?[{text:'{previous_price}',values:[{key:'previous_price',type:'price',price:{value:anterior,currency:'BRL'}}]}]:[]}},
  ],
  metadata:{id,product_id:'MLB24028629',url:`www.mercadolivre.com.br/produto-${id}/p/MLB24028629?pdp_filters=x#polycard_client=y`},
  pictures:{pictures:[{id:'730568-MLA99983575997_112025'}]},
  ...extra,
});
const contexto={picture_template:'https://http2.mlstatic.com/D_{square}_NP{2x}_{id}-{size}{sanitized_title}.webp',
  picture_size_default:'AB',picture_square_default:'Q',url_prefix:'https://'};
const pagina=(cartoes)=>`<html><script>window.x=1;</script><script>_n.ctx.r=${JSON.stringify({
  appProps:{pageProps:{initialState:{results:[{trends_categories:{polycard_context:contexto,polycards:cartoes}}]}}},
  texto:'chave } com "aspas" e {chaves}',
})};_n.ctx.extra={"a":1};</script></html>`;

test('extensão: tira id, título, preço, foto e link de cada cartão, na ordem do ranking',()=>{
  const html=pagina([
    cartao('MLB5410852112','Fone  Soundcore P20i',118.75,149.9),
    cartao('MLB5410852112','Repetido',1,null),
    cartao('MLB999','Id curto demais',10,null),
    cartao('MLB1234567','Pilha AA Duracell',21,null),
  ]);
  const produtos=lerPagina(html,'MLB1000');
  assert.deepEqual(produtos.map(p=>p.id),['MLB5410852112','MLB1234567']);
  assert.deepEqual(produtos[0],{
    id:'MLB5410852112',product_id:'MLB24028629',title:'Fone Soundcore P20i',price:118.75,original_price:149.9,
    image:'https://http2.mlstatic.com/D_Q_NP_2X_730568-MLA99983575997_112025-AB.webp',
    url:'https://www.mercadolivre.com.br/produto-MLB5410852112/p/MLB24028629',
    category:'MLB1000',position:1,pix:true,
  });
  assert.equal(produtos[1].original_price,null);
  assert.equal(produtos[1].position,2);
});

test('extensão: JSON com chaves dentro de textos e página de verificação',()=>{
  const texto='x={"a":"}{","b":{"c":1}};resto';
  assert.equal(extrairObjeto(texto,2),'{"a":"}{","b":{"c":1}}');
  assert.equal(lerPagina('<html>sem dados</html>','MLB1').length,0);
  assert.ok(pediuVerificacao('', 'https://www.mercadolivre.com.br/gz/account-verification?go=x'));
  assert.ok(!pediuVerificacao(pagina([]),'https://www.mercadolivre.com.br/mais-vendidos/MLB1000'));
});

test('extensão: reveza 4 categorias por rodada',()=>{
  assert.deepEqual(categoriasDaRodada(['A','B','C','D','E'],3),['D','E','A','B']);
  assert.deepEqual(categoriasDaRodada(['A','B'],1),['B','A']);
  assert.deepEqual(categoriasDaRodada([],0),[]);
});

// --- Site: /api/ml-list ---

function fakeDb(ofertas=[]){
  const state={row:null,executados:[]};
  const prepare=sql=>({
    sql,args:[],
    bind(...args){this.args=args;return this;},
    async run(){
      if(sql.startsWith('INSERT INTO ml_list')){const [items,categories,captured_at]=this.args;state.row={items,categories,captured_at};}
      return {};
    },
    async first(){return state.row;},
    async all(){return {results:ofertas.filter(id=>this.args.includes(id)).map(id=>({id}))};},
  });
  return {state,prepare,async batch(st){state.executados.push(...st.map(s=>[s.sql.replace(/\s+/g,' ').slice(0,40),s.args]));}};
}
const env=()=>({DB:fakeDb(),ML_LIST_TOKEN:'token-da-extensao-ml',PUBLISH_TOKEN:'token-do-bot'});
const post=(token,body)=>new Request('https://canaltabarato.com.br/api/ml-list',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const get=token=>new Request('https://canaltabarato.com.br/api/ml-list',{headers:{Authorization:`Bearer ${token}`}});
const item=(n,extra={})=>({id:`MLB10000000${n}`,title:`Produto ${n}`,price:10+n,original_price:null,
  image:'https://http2.mlstatic.com/D_Q_NP_2X_1-AB.webp',url:`https://www.mercadolivre.com.br/p/MLB2000000${n}`,
  category:'MLB1000',position:n,...extra});

test('site: extensão grava e o bot lê a cópia',async()=>{
  const ambiente=env();
  const itens=[1,2,3,4,5,6].map(n=>item(n));
  const gravado=await onRequestPost({request:post('token-da-extensao-ml',{categories:['MLB1000','lixo'],items:itens}),env:ambiente});
  assert.equal(gravado.status,201);
  const corpo=await (await onRequestGet({request:get('token-do-bot'),env:ambiente})).json();
  assert.equal(corpo.items.length,6);
  assert.deepEqual(corpo.categories,['MLB1000']);
  assert.ok(corpo.captured_at>0);
});

test('site: cada token só faz a sua parte e página vazia não troca a cópia',async()=>{
  const ambiente=env();
  assert.equal((await onRequestPost({request:post('token-do-bot',{items:[item(1)]}),env:ambiente})).status,401);
  assert.equal((await onRequestGet({request:get('token-da-extensao-ml'),env:ambiente})).status,401);
  assert.equal((await onRequestPost({request:post('token-da-extensao-ml',{items:[item(1),item(2)]}),env:ambiente})).status,422);
  assert.equal(ambiente.DB.state.row,null);
  assert.equal((await onRequestGet({request:get('token-do-bot'),env:ambiente})).status,404);
});

test('site: só aceita links do Mercado Livre e fotos do mlstatic',()=>{
  assert.ok(cleanItem(item(1)));
  assert.equal(cleanItem(item(1,{url:'https://evil.com/p/MLB1'})),null);
  assert.equal(cleanItem(item(1,{url:'http://www.mercadolivre.com.br/p/MLB1'})),null);
  assert.equal(cleanItem(item(1,{image:'https://evil.com/a.webp'})),null);
  assert.equal(cleanItem(item(1,{price:0})),null);
  assert.equal(cleanItem(item(1,{original_price:5})).original_price,null);   // menor que o preço
  assert.equal(cleanItem(item(1,{original_price:50})).original_price,50);
});

test('site: a cópia confere o preço das ofertas do Mercado Livre já publicadas',async()=>{
  const db=fakeDb(['mercadolivre_MLB24028629','mercadolivre_MLB100000002']);
  const agora=1_800_000_000;
  const n=await refreshPublished({DB:db},[
    {...item(1),id:'MLB5410852112',product_id:'MLB24028629',price:371.07,original_price:562.02,pix:true},
    item(2,{price:20,original_price:null}),
    item(3),   // não publicada: nada muda
  ],agora);
  assert.equal(n,2);
  const atualizacoes=db.state.executados.filter(([sql])=>sql.startsWith('UPDATE offers SET original_price'));
  assert.deepEqual(atualizacoes.map(([,a])=>a),[[562.02,34,'Preço no Pix','mercadolivre_MLB24028629'],[null,0,null,'mercadolivre_MLB100000002']]);
  const precos=db.state.executados.filter(([sql])=>sql.startsWith('UPDATE offers SET price_changed_at'));
  assert.deepEqual(precos[0][1],[371.07,agora,null,null,'mercadolivre_MLB24028629']);
  assert.equal(db.state.executados.filter(([sql])=>sql.startsWith('INSERT INTO offer_prices')).length,2);
});
