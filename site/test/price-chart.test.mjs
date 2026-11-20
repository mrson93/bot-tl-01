import assert from 'node:assert/strict';
import test from 'node:test';
import {inflateSync} from 'node:zlib';
import {cartao,deliverPriceAlerts,formatPriceAlertList,handleCallback,listPriceAlerts,termometro} from '../functions/_price_alerts.js';
import {graficoPng,precoCurto} from '../functions/_price_chart.js';
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
const ALERTA={id:7,chat_id:'55',produto_id:3,loja:'mercadolivre',id_produto:'MLB123',nome:'Air Fryer Mondial',
  avisar_menor:1,preco_alvo:null,queda_percent:null,avisar_estoque:0,preco_base:null,ativo:1,expira_em:AGORA+86400*300,
  link_afiliado:'https://www.mercadolivre.com.br/p/MLB123'};
// 40 dias: começa em 500, cai para 400 no meio.
const DIAS=Array.from({length:40},(_,i)=>({dia:new Date(Date.UTC(2026,9,12+i)).toISOString().slice(0,10),preco:i<20?500:400}));
const enviar=()=>{
  const chamadas=[];
  const fetcher=async(url,init)=>{
    const metodo=url.split('/').pop();
    chamadas.push({metodo,corpo:init.body instanceof FormData?init.body:JSON.parse(init.body)});
    return new Response('{}',{status:200});
  };
  return {chamadas,fetcher};
};

function lerPng(bytes) {
  assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const vista=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const blocos={};let pos=8;
  while(pos<bytes.length){
    const tamanho=vista.getUint32(pos), tipo=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
    blocos[tipo]=(blocos[tipo]||[]).concat([bytes.subarray(pos+8,pos+8+tamanho)]);
    pos+=12+tamanho;
  }
  return blocos;
}

test('termômetro: verde no preço baixo, vermelho no caro, amarelo no meio e espera com pouco histórico',()=>{
  const ano=[...Array(30).fill(500),...Array(10).fill(400)];
  assert.equal(termometro(400,ano).nivel,'baixo');
  assert.match(termometro(400,ano).texto,/mais barato que em 75% dos últimos 40 dias/);
  assert.equal(termometro(520,ano).nivel,'caro');
  assert.match(termometro(520,ano).texto,/mais barato em 100%/);
  assert.equal(termometro(450,[...Array(20).fill(400),...Array(20).fill(500)]).nivel,'medio');
  assert.equal(termometro(300,Array(13).fill(500)).nivel,'aprendendo');
  assert.equal(termometro(null,ano),null);
  // Preço que nunca mudou fica "na média".
  assert.equal(termometro(500,Array(30).fill(500)).nivel,'medio');
});

test('gráfico vira um PNG válido e marca menor e maior',async()=>{
  const r=await graficoPng(DIAS,{alvo:420});
  const blocos=lerPng(r.png);
  const cabecalho=new DataView(blocos.IHDR[0].buffer,blocos.IHDR[0].byteOffset);
  assert.equal(cabecalho.getUint32(0),800);
  assert.equal(cabecalho.getUint32(4),420);
  const cru=inflateSync(Buffer.concat(blocos.IDAT));
  assert.equal(cru.length,(800+1)*420);
  assert.ok(r.png.length<30_000);
  assert.equal(r.minimo,400);
  assert.equal(r.maximo,500);
  assert.equal(r.atual,400);
  assert.equal(new Date(r.diaMenor*86400000).toISOString().slice(0,10),'2026-11-01');
  assert.equal(await graficoPng(DIAS.slice(0,1)),null);
  assert.equal(precoCurto(1299.9),'R$ 1.299,90');
});

test('cartão mostra o termômetro e o botão de gráfico',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':ALERTA,'MIN(preco) AS minimo':{minimo:400,maximo:500,desde:AGORA-40*86400,atual:400,disponivel:1},
    'GROUP BY dia':DIAS});
  const r=await cartao({DB:db},'55',7,AGORA);
  assert.match(r.text,/🟢 Preço baixo/);
  assert.ok(r.markup.inline_keyboard.flat().some(b=>b.callback_data==='a:7:g'));
});

test('lista mostra o selo do termômetro de cada produto',async()=>{
  const db=fakeDb({'FROM alerta_precos a JOIN':[{...ALERTA,atual:520},{...ALERTA,id:8,produto_id:4,atual:90}],
    'GROUP BY l.produto_id':[...DIAS.map(d=>({...d,produto_id:3})),{produto_id:4,dia:'2026-11-01',preco:90}]});
  const lista=await listPriceAlerts({DB:db},'55',AGORA);
  assert.equal(lista[0].termometro.nivel,'caro');
  assert.equal(lista[1].termometro.nivel,'aprendendo');
  const texto=formatPriceAlertList(lista);
  assert.match(texto,/agora R\$\s?520,00 🔴/);
  assert.doesNotMatch(texto,/⏳/);
});

test('aviso traz o termômetro e o botão de gráfico',async()=>{
  const {chamadas,fetcher}=enviar();
  const db=fakeDb({'SELECT a.*,p.nome,p.imagem':ALERTA,'MIN(preco) AS minimo':{minimo:400,maximo:500,desde:1,atual:400,disponivel:1},'GROUP BY dia':DIAS});
  await deliverPriceAlerts({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},[{alerta_id:7,produto_id:3,preco:390,link:'https://meli.la/x',motivo:'menor_preco'}],AGORA,fetcher);
  assert.match(chamadas[0].corpo.text,/🟢 Preço baixo: mais barato que em 100%/);
  assert.equal(chamadas[0].corpo.reply_markup.inline_keyboard[0][1].callback_data,'a:7:g');
});

test('botão de gráfico manda a foto e os períodos trocam a mesma foto',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':{...ALERTA,preco_alvo:420},'GROUP BY dia':DIAS});
  const env={DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'};
  const r=await handleCallback(env,'55','a:7:g',AGORA);
  assert.equal(r.edit,false);
  assert.match(r.photo.caption,/Últimos 90 dias \(acompanhado desde 12\/10\/2026\)/);
  assert.match(r.photo.caption,/🟢 Menor: R\$\s?400,00 em 01\/11\/2026/);
  assert.match(r.photo.caption,/🔴 Maior: R\$\s?500,00 em 12\/10\/2026/);
  assert.deepEqual(r.markup.inline_keyboard[0].map(b=>b.callback_data),['a:7:gt:30','-','a:7:gt:365']);
  assert.equal((await handleCallback(env,'55','-',AGORA)).answer,'Este período já está aberto');

  const {chamadas,fetcher}=enviar();
  const consulta=(data,mensagem)=>({id:'q',data,from:{id:55},message:{message_id:9,chat:{id:55,type:'private'},...mensagem}});
  await responderBotao(env,consulta('a:7:g',{text:'cartão'}),fetcher,AGORA);
  assert.deepEqual(chamadas.map(c=>c.metodo),['answerCallbackQuery','sendPhoto']);
  const envio=chamadas[1].corpo;
  assert.equal(envio.get('chat_id'),'55');
  assert.equal(envio.get('parse_mode'),'HTML');
  assert.equal(JSON.parse(envio.get('reply_markup')).inline_keyboard[1][0].callback_data,'a:7:c');
  assert.deepEqual([...new Uint8Array(await envio.get('photo').arrayBuffer()).subarray(1,4)],[80,78,71]);

  await responderBotao(env,consulta('a:7:gt:365',{photo:[{file_id:'x'}]}),fetcher,AGORA);
  assert.equal(chamadas[3].metodo,'editMessageMedia');
  assert.equal(chamadas[3].corpo.get('message_id'),'9');
  assert.equal(JSON.parse(chamadas[3].corpo.get('media')).media,'attach://grafico');
  assert.ok(chamadas[3].corpo.get('grafico'));

  // Sem histórico: explica em texto.
  const vazio=await handleCallback({DB:fakeDb({'SELECT a.*,p.loja':ALERTA})},'55','a:7:g',AGORA);
  assert.match(vazio.text,/Ainda não tenho histórico suficiente/);
});
