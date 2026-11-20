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
  assert.match(produto[0],/VALUES\(\?,\?,\?,\?,1,0,\?\)/);
  assert.equal(produto[1][3],null); // "fone" é curto demais para virar nome
  const alerta=db.executados.find(([sql])=>sql.includes('INSERT INTO alerta_precos'));
  assert.deepEqual(alerta[1].slice(0,3),['55',12,199.9]);
});

test('respeita o limite por pessoa e recusa a Amazon por enquanto',async()=>{
  const cheio=fakeDb({'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:5}});
  assert.match(await handlePriceAlert({DB:cheio},'55',LINK,1000,semRede),/já tem 5 produtos/);
  const amazon=await handlePriceAlert({DB:fakeDb()},'55','https://www.amazon.com.br/dp/B0C1234567',1000,semRede);
  assert.match(amazon,/com produtos do <b>Mercado Livre<\/b> e da <b>Shopee<\/b>/);
});

test('link colado na conversa vira alerta de preço; número remove',async()=>{
  const db=fakeDb({'INSERT INTO monitor_produtos':{id:3,nome:'Fone'},'alerta_precos a JOIN':[{id:30,nome:'Fone',id_produto:'MLB123'}]});
  const criado=await handleUpdate({DB:db},{message:{text:LINK,chat:{id:55,type:'private'}}},1000);
  assert.match(criado.text,/menor preço do histórico/);
  assert.equal(criado.markup.keyboard[0][1].text,'💰 Definir um valor');
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
    {loja:'mercadolivre',id_produto:'MLB777',tipo:'catalogo',nome:null});
  assert.equal(pedidos.length,2);
  assert.match(pedidos[0],/TaBaratoAlertaBot/);
});

test('link de perfil de afiliado vira o produto compartilhado',async()=>{
  const {resolveProductLink}=await import('../functions/_product_link.js');
  const pagina='<a href="https://www.mercadolivre.com.br/power-bank/p/MLB48692416?pdp_filters=item_id%3AMLB1">x</a><a href="https://www.mercadolivre.com.br/outro/p/MLB999">y</a>';
  const fetcher=async(url)=>url.startsWith('https://meli.la')
    ?new Response(null,{status:301,headers:{Location:'https://www.mercadolivre.com.br/social/fulano?ref=abc'}})
    :new Response(pagina,{status:200});
  assert.deepEqual(await resolveProductLink('https://meli.la/1e8sTgB',fetcher),
    {loja:'mercadolivre',id_produto:'MLB48692416',tipo:'catalogo',nome:null});
});

test('perfil de afiliado sem produto explica o que mandar',async()=>{
  const fetcher=async(url)=>url.startsWith('https://meli.la')
    ?new Response(null,{status:301,headers:{Location:'https://www.mercadolivre.com.br/social/fulano?matt_word=x&ref=abc'}})
    :new Response('<html>sem produto</html>',{status:200});
  const resposta=await handlePriceAlert({DB:fakeDb()},'55','https://meli.la/1e8sTgB',1000,fetcher);
  assert.match(resposta,/perfil de afiliado/);
});

test('nome vem do endereço ou da prévia da página',async()=>{
  const {parseProductLink,resolveProductLink}=await import('../functions/_product_link.js');
  assert.equal(parseProductLink('https://www.mercadolivre.com.br/carregador-portatil-anker/p/MLB1').nome,'Carregador portatil anker');
  assert.equal(parseProductLink('https://produto.mercadolivre.com.br/MLB-123-fone-bluetooth-jbl-_JM').nome,'Fone bluetooth jbl');
  const pagina='<meta property="og:title" content="Power Bank Anker 25000mAh - R$ 689"/><a href="https://www.mercadolivre.com.br/pb/p/MLB48692416">x</a>';
  const fetcher=async(url)=>url.startsWith('https://meli.la')
    ?new Response(null,{status:301,headers:{Location:'https://www.mercadolivre.com.br/social/fulano?ref=abc'}})
    :new Response(pagina,{status:200});
  assert.equal((await resolveProductLink('https://meli.la/x',fetcher)).nome,'Power Bank Anker 25000mAh');
});

test('escolha entre menor preço do histórico e um valor',async()=>{
  const {handlePriceChoice}=await import('../functions/_price_alerts.js');
  const recente={id:7,nome:'Power Bank Anker',id_produto:'MLB1'};
  const db=fakeDb({'ORDER BY a.criado_em DESC':recente});
  const pedir=await handlePriceChoice({DB:db},'55','💰 Definir um valor',1000);
  assert.match(pedir.text,/Quanto você quer pagar por Power Bank Anker/);
  const valor=await handlePriceChoice({DB:db},'55','599,90',1000);
  assert.match(valor.text,/R\$\s?599,90/);
  const update=db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET preco_alvo'));
  assert.deepEqual(update[1],[599.9,7,'55']);
  const menor=await handlePriceChoice({DB:db},'55','🔥 Menor preço do histórico',1000);
  assert.match(menor.text,/menor preço do histórico/);
  assert.equal(await handlePriceChoice({DB:db},'55','air fryer',1000),null);
  const semAlerta=await handlePriceChoice({DB:fakeDb()},'55','599,90',1000);
  assert.match(semAlerta,/Primeiro cole o link/);
});

test('reconhece os links da Shopee, inclusive o destino do link curto',async()=>{
  const {parseProductLink}=await import('../functions/_product_link.js');
  assert.deepEqual(parseProductLink('https://shopee.com.br/Fone-Bluetooth-JBL-i.123456.987654321?sp_atk=x'),
    {loja:'shopee',id_produto:'123456_987654321',tipo:null,nome:'Fone Bluetooth JBL'});
  assert.equal(parseProductLink('https://shopee.com.br/product/123456/987654321').id_produto,'123456_987654321');
  assert.equal(parseProductLink('https://shopee.com.br/opaanlp/1791562791/23894195354?__mobile__=1').id_produto,'1791562791_23894195354');
});

test('botão do canal cria o alerta do produto e copia o histórico do site',async()=>{
  const {handleStartProduct}=await import('../functions/_price_alerts.js');
  const db=fakeDb({
    'SELECT title FROM offers':{title:'Power Bank Anker 25000mAh'},
    'INSERT INTO monitor_produtos':{id:21,nome:'Power Bank Anker 25000mAh'},
    'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},
    'COUNT(DISTINCT produto_id)':{total:0},
  });
  const resposta=await handleStartProduct({DB:db},'55','sp_1791562791_23894195354',1000);
  assert.match(resposta.text,/Power Bank Anker/);
  assert.equal(resposta.markup.keyboard[0][0].text,'🔥 Menor preço do histórico');
  const copia=db.executados.find(([sql])=>sql.includes('FROM offer_prices'));
  assert.deepEqual(copia[1].slice(0,2),[21,'shopee_1791562791_23894195354']);
  assert.equal(await handleStartProduct({DB:db},'55','xx_123',1000),null);
  const comando=await handleUpdate({DB:fakeDb({'INSERT INTO monitor_produtos':{id:3,nome:'Fone'}})},{message:{text:'/start ml_MLB123',chat:{id:55,type:'private'}}},1000);
  assert.match(comando.text,/Fone/);
});
