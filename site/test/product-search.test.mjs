import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {MENU,MENU_BUSCA} from '../functions/_price_alerts.js';
import {buscarProdutos,formatarResultados,PERGUNTA_BUSCA,termoBusca} from '../functions/_product_search.js';
import {handleAlertCallback,handleUpdate} from '../functions/_telegram_alerts.js';
import {responderBotao} from '../functions/api/telegram-alerts.js';

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

const AGORA=Math.floor(Date.UTC(2026,10,20,15)/1000);
const CATALOGO=[
  {id:'mercadolivre_MLB111',title:'Air Fryer Mondial 4L',price:299.9,rating:4.7,sales:1500,image_url:'https://http2.mlstatic.com/a.jpg'},
  {id:'shopee_10_20',title:'Air Fryer Britânia 5L',price:349,rating:0,sales:0},
  {id:'amazon_B0X',title:'Air Fryer Amazon',price:200},       // nunca vem (alerta não aceita Amazon)
  {id:'mercadolivre_lixo',title:'Air Fryer quebrado',price:10},  // id inválido
];
const NODES=[
  {itemId:20,shopId:10,productName:'Air Fryer Britânia 5L (repetido)',priceMin:'340.00',sales:50,ratingStar:'4.9'},
  {itemId:2,shopId:1,productName:'Air Fryer Oster 3L',priceMin:'219.90',sales:12000,ratingStar:'4.8',imageUrl:'https://cf.shopee.com.br/x'},
  {itemId:3,shopId:1,productName:'Fritadeira sem óleo',price:'99.9'},
];
const ENV_SHOPEE={SHOPEE_APP_ID:'123',SHOPEE_SECRET:'segredo'};
function shopee(nodes=NODES,status=200){
  const pedidos=[];
  const fetcher=async(url,init)=>{
    pedidos.push({url,init});
    return new Response(JSON.stringify({data:{productOfferV2:{nodes}}}),{status});
  };
  return {pedidos,fetcher};
}
const historicoMonitor=[...Array(30).fill(0).map((_,i)=>({loja:'mercadolivre',id_produto:'MLB111',dia:`2026-10-${String(i+1).padStart(2,'0')}`,preco:i<20?400:350,desde:AGORA-50*86400}))];

test('termo de busca: 2 a 60 letras e nada de link',()=>{
  assert.equal(termoBusca('  air   fryer '),'air fryer');
  assert.equal(termoBusca('a'),'');
  assert.equal(termoBusca('x'.repeat(61)),'');
  assert.equal(termoBusca('https://shopee.com.br/x'),'');
});

test('junta catálogo e Shopee ao vivo, sem repetir, com histórico de quem já acompanhamos',async()=>{
  const db=fakeDb({'FROM offers':CATALOGO,'FROM monitor_produtos p JOIN monitor_leituras':historicoMonitor});
  const {pedidos,fetcher}=shopee();
  const itens=await buscarProdutos({DB:db,...ENV_SHOPEE},'air fryer',fetcher,AGORA);
  assert.deepEqual(itens.map(i=>`${i.loja}:${i.id_produto}`),['mercadolivre:MLB111','shopee:10_20','shopee:1_2','shopee:1_3']);
  assert.equal(itens[0].dias,50);
  assert.equal(itens[0].termometro.nivel,'baixo');
  assert.equal(itens[2].preco,219.9);
  assert.equal(itens[3].preco,99.9);
  // Busca no catálogo: um LIKE por palavra, só ML e Shopee.
  const sql=db.executados.find(([s])=>s.includes('FROM offers'));
  assert.deepEqual(sql[1],['%air%','%fryer%']);
  // Assinatura da Shopee igual à do Python: SHA256(AppId + Timestamp + Payload + Secret).
  const {init}=pedidos[0];
  const ts=init.headers.Authorization.match(/Timestamp=(\d+)/)[1];
  const esperado=createHash('sha256').update(`123${ts}${init.body}segredo`).digest('hex');
  assert.match(init.headers.Authorization,new RegExp(`^SHA256 Credential=123, Timestamp=${ts}, Signature=${esperado}$`));
  assert.match(JSON.parse(init.body).query,/keyword:"air fryer"/);
});

test('sem as chaves da Shopee, ou com a Shopee fora do ar, a busca fica no catálogo',async()=>{
  const {pedidos,fetcher}=shopee();
  const db=fakeDb({'FROM offers':CATALOGO});
  assert.equal((await buscarProdutos({DB:db},'air fryer',fetcher,AGORA)).length,2);
  assert.equal(pedidos.length,0);
  const fora=shopee([],500);
  assert.equal((await buscarProdutos({DB:db,...ENV_SHOPEE},'air fryer',fora.fetcher,AGORA)).length,2);
});

test('resultados com botões numerados, palavra e nova busca',()=>{
  const r=formatarResultados('Air Fryer',[
    {loja:'mercadolivre',id_produto:'MLB111',nome:'Air <b>Fryer',preco:299.9,nota:4.7,vendas:1500,dias:50,termometro:{nivel:'baixo',emoji:'🟢',texto:'Preço baixo: x'}},
    {loja:'shopee',id_produto:'1_2',nome:'Oster',preco:219.9,nota:0,vendas:0},
  ],'air fryer');
  assert.match(r.text,/Air &lt;b&gt;Fryer/);
  assert.match(r.text,/⭐ 4,7 · 1,5 mil vendidos/);
  assert.match(r.text,/📈 Acompanhado há 50 dia\(s\) · 🟢 Preço baixo/);
  assert.deepEqual(r.markup.inline_keyboard[0].map(b=>b.callback_data),['b:ml:MLB111','b:sp:1_2']);
  assert.equal(r.markup.inline_keyboard[1][0].callback_data,'k:air fryer');
  assert.equal(r.markup.inline_keyboard[2][0].callback_data,'bn');
  for(const b of r.markup.inline_keyboard.flat()) assert.ok(new TextEncoder().encode(b.callback_data).length<=64);
  const vazio=formatarResultados('xyz abc',[],'');
  assert.match(vazio.text,/Não achei/);
  assert.deepEqual(vazio.markup.inline_keyboard.map(l=>l[0].callback_data),['bn']);
});

test('menu, texto solto, resposta à pergunta e /buscar fazem a busca',async()=>{
  const env={DB:fakeDb({'FROM offers':CATALOGO})};
  const msg=(text,extra={})=>({message:{chat:{id:55,type:'private'},text,...extra}});
  assert.deepEqual(MENU.keyboard[0].map(b=>b.text),['➕ Novo alerta',MENU_BUSCA]);
  const pergunta=await handleUpdate(env,msg(MENU_BUSCA),AGORA);
  assert.ok(pergunta.text.startsWith(PERGUNTA_BUSCA));
  assert.equal(pergunta.markup.force_reply,true);
  assert.equal((await handleUpdate(env,msg('/buscar'),AGORA)).markup.force_reply,true);
  for(const r of [
    await handleUpdate(env,msg('air fryer'),AGORA),
    await handleUpdate(env,msg('/buscar air fryer'),AGORA),
    await handleUpdate(env,msg('air fryer',{reply_to_message:{from:{is_bot:true},text:`${PERGUNTA_BUSCA}\nDigite o nome`}}),AGORA),
  ]) assert.match(r.text,/Resultados para "air fryer"/);
  // Nada de alerta por palavra criado sem pedir.
  assert.ok(!env.DB.executados.some(([sql])=>sql.includes('INSERT OR IGNORE INTO alert_subscriptions')));
});

test('tocar num resultado da Shopee cria o alerta com nome e preço de agora',async()=>{
  const db=fakeDb({
    'SELECT id,nome FROM monitor_produtos':null,
    'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},
    'COUNT(DISTINCT produto_id)':{total:0},
    'INSERT INTO monitor_produtos':{id:9,nome:'Air Fryer Oster 3L'},
    'SELECT preco FROM monitor_leituras':{preco:219.9},
    'INSERT INTO alerta_precos':{id:70},
    'SELECT a.*,p.loja':{id:70,produto_id:9,loja:'shopee',id_produto:'1_2',nome:'Air Fryer Oster 3L',avisar_menor:1,ativo:1,expira_em:AGORA+9e6},
  });
  const {pedidos,fetcher}=shopee([NODES[1]]);
  const r=await handleAlertCallback({DB:db,...ENV_SHOPEE},'55','b:sp:1_2',AGORA,fetcher);
  assert.match(r.text,/Alerta criado/);
  assert.match(JSON.parse(pedidos[0].init.body).query,/shopId:1,itemId:2/);
  const produto=db.executados.find(([sql])=>sql.includes('INSERT INTO monitor_produtos'));
  assert.deepEqual(produto[1].slice(0,4),['shopee','1_2',null,'Air Fryer Oster 3L']);
  const leitura=db.executados.find(([sql])=>sql.includes('SELECT ?1,?2,NULL,1,?3'));
  assert.deepEqual(leitura[1],[9,219.9,AGORA]);
  assert.equal(db.executados.find(([sql])=>sql.includes('INSERT INTO alerta_precos'))[1][5],'busca');
  assert.equal((await handleAlertCallback({DB:db},'55','b:sp:abc',AGORA,fetcher)).answer,'Produto inválido');
});

test('botão da palavra cria o alerta por palavra e o de nova busca pergunta de novo',async()=>{
  const db=fakeDb({'FROM alert_subscriptions WHERE chat_id':{total:0}});
  const r=await handleAlertCallback({DB:db},'55','k:air fryer',AGORA);
  assert.match(r.text,/Aviso quando aparecer oferta de <b>air fryer<\/b>/);
  assert.deepEqual(db.executados.at(-1)[1],['55','air fryer',AGORA]);
  assert.equal((await handleAlertCallback({DB:db},'55','bn',AGORA)).markup.force_reply,true);
  // O webhook manda a pergunta como mensagem nova (com o campo de resposta).
  const chamadas=[];
  const fetcher=async(url,init)=>{chamadas.push({metodo:url.split('/').pop(),corpo:JSON.parse(init.body)});return new Response('{}');};
  await responderBotao({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},{id:'q',data:'bn',from:{id:55},message:{message_id:3,text:'x',chat:{id:55,type:'private'}}},fetcher,AGORA);
  assert.deepEqual(chamadas.map(c=>c.metodo),['answerCallbackQuery','sendMessage']);
  assert.equal(chamadas[1].corpo.reply_markup.force_reply,true);
});
