import assert from 'node:assert/strict';
import test from 'node:test';
import {respostaInline,usuarioDoBot} from '../functions/_inline.js';
import {onRequestPost as webhook,responderInline} from '../functions/api/telegram-alerts.js';

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
  {id:'mercadolivre_MLB111',title:'Fone <JBL> Tune 520',price:199.9,rating:4.8,sales:900,image_url:'https://http2.mlstatic.com/a.jpg'},
  {id:'aliexpress_1005003214550744',title:'Fone Bluetooth TWS',price:59.9,image_url:'https://golpe.example/x.jpg'},
];

test('nome do bot vem do ambiente, com padrão seguro',()=>{
  assert.equal(usuarioDoBot({}),'TaBaratoAlertaDePrecoBot');
  assert.equal(usuarioDoBot({TELEGRAM_ALERTS_BOT_USERNAME:'OutroBot'}),'OutroBot');
  assert.equal(usuarioDoBot({TELEGRAM_ALERTS_BOT_USERNAME:'x;y'}),'TaBaratoAlertaDePrecoBot');
});

test('consulta inline devolve produtos prontos para mandar, com loja e alerta',async()=>{
  const db=fakeDb({'FROM offers':CATALOGO});
  const r=await respostaInline({DB:db},'fone',AGORA);
  assert.equal(r.cache_time,300);
  assert.deepEqual(r.button,{text:'🔔 Criar alerta de preço no bot',start_parameter:'inline'});
  assert.equal(r.results.length,2);
  const [ml,ae]=r.results;
  assert.equal(ml.type,'article');
  assert.equal(ml.id,'ml_MLB111');
  assert.equal(ml.thumbnail_url,'https://http2.mlstatic.com/a.jpg');
  assert.match(ml.description,/R\$\s?199,90 · Mercado Livre/);
  assert.match(ml.input_message_content.message_text,/🛍 <b>Fone &lt;JBL&gt; Tune 520<\/b>/);
  assert.match(ml.input_message_content.message_text,/@TaBaratoAlertaDePrecoBot/);
  assert.deepEqual(ml.reply_markup.inline_keyboard,[
    [{text:'🛒 Ver na loja',url:'https://canaltabarato.com.br/go/mercadolivre_MLB111'}],
    [{text:'🔔 Criar alerta de preço',url:'https://t.me/TaBaratoAlertaDePrecoBot?start=ml_MLB111'}]]);
  assert.equal(ae.thumbnail_url,undefined);  // imagem fora das lojas não vai
  assert.equal(ae.reply_markup.inline_keyboard.at(-1)[0].url,'https://t.me/TaBaratoAlertaDePrecoBot?start=ae_1005003214550744');
  // Consulta curta: nada de busca, só o botão para o bot.
  const curta=await respostaInline({DB:db},'fo',AGORA);
  assert.deepEqual(curta.results,[]);
  assert.equal(db.executados.filter(([sql])=>sql.includes('FROM offers')).length,1);
});

test('webhook responde a consulta inline e confere o perfil uma vez por instância',async()=>{
  const DB=fakeDb({'FROM offers':CATALOGO});
  const env={DB,TELEGRAM_ALERTS_BOT_TOKEN:'t',TELEGRAM_ALERTS_WEBHOOK_SECRET:'s'.repeat(32)};
  const chamadas=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const metodo=String(url).split('/').pop();
    chamadas.push(metodo);
    if(metodo==='getWebhookInfo') return Response.json({ok:true,result:{url:'https://canaltabarato.com.br/api/telegram-alerts',allowed_updates:['message','callback_query']}});
    if(metodo==='getMyDescription') return Response.json({ok:true,result:{description:'antiga'}});
    if(metodo==='alerta-icone.jpg') return new Response(new Uint8Array([255,216]),{status:200});
    if(metodo==='answerInlineQuery') chamadas.push(JSON.parse(init.body));
    return new Response('{}',{status:200});
  };
  const pedido=update=>new Request('https://canaltabarato.com.br/api/telegram-alerts',{method:'POST',
    headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'s'.repeat(32)},body:JSON.stringify(update)});
  const pendentes=[];
  try{
    const r=await webhook({request:pedido({update_id:1,inline_query:{id:'99',from:{id:5},query:'fone',offset:''}}),env,waitUntil:p=>pendentes.push(p)});
    assert.equal(r.status,200);
    await Promise.all(pendentes);
    await webhook({request:pedido({update_id:2,inline_query:{id:'100',from:{id:5},query:'fone',offset:''}}),env,waitUntil:p=>pendentes.push(p)});
    await Promise.all(pendentes);
  }finally{globalThis.fetch=original;}
  const resposta=chamadas.find(c=>typeof c==='object');
  assert.equal(resposta.inline_query_id,'99');
  assert.equal(resposta.results.length,2);
  // Perfil: webhook ganha inline_query e a foto é enviada, só na primeira vez.
  assert.equal(chamadas.filter(c=>c==='getWebhookInfo').length,1);
  assert.ok(chamadas.includes('setWebhook'));
  assert.ok(chamadas.includes('setMyProfilePhoto'));
  assert.equal(chamadas.filter(c=>c==='answerInlineQuery').length,2);
  // Nada de gravar quem pesquisou.
  assert.ok(!DB.executados.some(([sql])=>/INSERT|UPDATE|DELETE/.test(sql)));
});

test('falha na busca responde vazio em vez de travar a consulta',async()=>{
  const enviados=[];
  const fetcher=async(url,init)=>{enviados.push(JSON.parse(init.body));return new Response('{}');};
  const quebrado={prepare(){throw new Error('D1 fora');}};
  await responderInline({DB:quebrado,TELEGRAM_ALERTS_BOT_TOKEN:'t'},{id:'7',query:'fone'},fetcher,AGORA);
  assert.deepEqual(enviados[0],{inline_query_id:'7',results:[],cache_time:30});
});
