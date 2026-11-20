import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deliverPriceAlerts, formatPriceNotice, handlePriceAlert, parsePrice, parsePriceRequest,
} from '../functions/_price_alerts.js';
import {handleUpdate} from '../functions/_telegram_alerts.js';

// D1 de mentira: responde pela primeira regra cujo trecho aparece no SQL.
function fakeDb(regras={}) {
  const executados=[];
  const responder=(sql,args,tipo)=>{
    for(const [trecho,resposta] of Object.entries(regras)){
      if(sql.includes(trecho)) return typeof resposta==='function'?resposta(args,tipo):resposta;
    }
    return tipo==='all'?[]:null;
  };
  return {
    executados,
    prepare(sql){
      return {
        sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){executados.push([sql,this.args]);return responder(sql,this.args,'first');},
        async all(){executados.push([sql,this.args]);return {results:responder(sql,this.args,'all')||[]};},
        async run(){executados.push([sql,this.args]);return {meta:{changes:1}};},
      };
    },
    async batch(stmts){for(const s of stmts) executados.push([s.sql,s.args]);return [];},
  };
}
const semRede=async()=>{throw new Error('sem rede');};
const LINK='https://www.mercadolivre.com.br/fone/p/MLB123';

test('entende o preço do jeito que as pessoas escrevem',()=>{
  assert.equal(parsePrice('199,90'),199.9);
  assert.equal(parsePrice('R$ 1.299,90'),1299.9);
  assert.equal(parsePrice('199.90'),199.9);
  assert.equal(parsePrice('1.299'),1299);
  assert.equal(parsePrice('abc'),null);
  assert.deepEqual(parsePriceRequest(`${LINK} 199,90`),{link:LINK,alvo:199.9,precoInvalido:false});
  assert.equal(parsePriceRequest('air fryer'),null);
});

test('cadastra alerta com preço e cria o produto só para o público',async()=>{
  const db=fakeDb({
    'INSERT INTO monitor_produtos':{id:12,nome:null},
    'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},
    'COUNT(DISTINCT produto_id)':{total:0},
  });
  const resposta=await handlePriceAlert({DB:db},'55',`${LINK} 199,90`,1000,semRede);
  assert.match(resposta,/R\$\s?199,90/);
  const produto=db.executados.find(([sql])=>sql.includes('INSERT INTO monitor_produtos'));
  assert.match(produto[0],/VALUES\(\?,\?,\?,1,0,\?\)/);
  const alerta=db.executados.find(([sql])=>sql.includes('INSERT INTO alerta_precos'));
  assert.deepEqual(alerta[1].slice(0,3),['55',12,199.9]);
});

test('respeita o limite por pessoa e recusa a Amazon por enquanto',async()=>{
  const cheio=fakeDb({'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:5}});
  assert.match(await handlePriceAlert({DB:cheio},'55',LINK,1000,semRede),/já tem 5 produtos/);
  const amazon=await handlePriceAlert({DB:fakeDb()},'55','https://www.amazon.com.br/dp/B0C1234567',1000,semRede);
  assert.match(amazon,/só com produtos do <b>Mercado Livre<\/b>/);
});

test('link colado na conversa vira alerta de preço; número remove',async()=>{
  const db=fakeDb({'INSERT INTO monitor_produtos':{id:3,nome:'Fone'},'alerta_precos a JOIN':[{id:30,nome:'Fone',id_produto:'MLB123'}]});
  const criado=await handleUpdate({DB:db},{message:{text:LINK,chat:{id:55,type:'private'}}},1000);
  assert.match(criado,/menor preço real/);
  const removido=await handleUpdate({DB:db},{message:{text:'/remover 1',chat:{id:55,type:'private'}}},1000);
  assert.match(removido,/removido: Fone/);
  assert.ok(db.executados.some(([sql,args])=>sql.startsWith('DELETE FROM alerta_precos WHERE id=?')&&args[0]===30));
});

test('entrega o aviso, pausa o alerta com preço e ignora link estranho',async()=>{
  const enviados=[];
  const db=fakeDb({'SELECT chat_id,preco_alvo FROM alerta_precos':{chat_id:'55',preco_alvo:200}});
  const fetcher=async(url,init)=>{enviados.push(JSON.parse(init.body));return new Response('{}',{status:200});};
  const total=await deliverPriceAlerts({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[
    {alerta_id:1,produto_id:2,preco:189.9,link:'https://go.canaltabarato.com.br/x',nome:'Fone',motivo:'alvo'},
    {alerta_id:1,produto_id:2,preco:189.9,link:'https://golpe.example/x',nome:'Fone',motivo:'alvo'},
  ],1000,fetcher);
  assert.equal(total,1);
  assert.equal(enviados[0].chat_id,'55');
  assert.match(enviados[0].text,/você pediu até R\$\s?200,00/);
  assert.ok(db.executados.some(([sql])=>sql.startsWith('UPDATE alerta_precos SET ultimo_aviso_em')));
});

test('quem bloqueou o bot tem os alertas apagados',async()=>{
  const db=fakeDb({'SELECT chat_id,preco_alvo FROM alerta_precos':{chat_id:'55',preco_alvo:null}});
  await deliverPriceAlerts({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},
    [{alerta_id:1,produto_id:2,preco:90,link:'https://meli.la/x',motivo:'menor_preco'}],1000,
    async()=>new Response('{}',{status:403}));
  assert.ok(db.executados.some(([sql])=>sql==='DELETE FROM alerta_precos WHERE chat_id=?'));
});

test('texto do aviso de menor preço',()=>{
  const texto=formatPriceNotice({motivo:'menor_preco',dias_janela:45,nome:'Fone <X>',preco:90,media:120,dias_media:30,abaixo:25},null);
  assert.match(texto,/Menor preço em 45 dias/);
  assert.match(texto,/Fone &lt;X&gt;/);
  assert.match(texto,/25% abaixo da média/);
});

test('segue meli.la se identificando, até a página do produto',async()=>{
  const {resolveProductLink}=await import('../functions/_product_link.js');
  const pedidos=[];
  const saltos={
    'https://meli.la/AbC123':'https://mercadolivre.com/sec/xyz',
    'https://mercadolivre.com/sec/xyz':'https://www.mercadolivre.com.br/fone/p/MLB777?matt_tool=1',
  };
  const fetcher=async(url,init)=>{
    pedidos.push(init.headers['User-Agent']);
    if(!init.headers['User-Agent']) return new Response(null,{status:403});
    return new Response(null,{status:301,headers:{Location:saltos[url]}});
  };
  assert.deepEqual(await resolveProductLink('https://meli.la/AbC123',fetcher),
    {loja:'mercadolivre',id_produto:'MLB777',tipo:'catalogo'});
  assert.equal(pedidos.length,2);
  assert.match(pedidos[0],/TaBaratoAlertaBot/);
});

test('link de perfil de afiliado explica o que mandar',async()=>{
  const fetcher=async()=>new Response(null,{status:301,headers:{Location:'https://www.mercadolivre.com.br/social/fulano?matt_word=x&ref=abc'}});
  const resposta=await handlePriceAlert({DB:fakeDb()},'55','https://meli.la/1e8sTgB',1000,fetcher);
  assert.match(resposta,/perfil de afiliado/);
});
