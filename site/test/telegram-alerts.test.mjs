import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ALERTS_PER_DAY,
  MAX_KEYWORDS_PER_CHAT,
  handleUpdate,
  notifyOfferAlerts,
  parseCommand,
  titleMatches,
  validKeyword,
} from '../functions/_telegram_alerts.js';
import {onRequestPost as webhook} from '../functions/api/telegram-alerts.js';

function database() {
  const subscriptions=[],deliveries=[];
  function statement(sql) {
    return {
      args:[],
      bind(...args){this.args=args;return this;},
      async all(){
        if(sql.startsWith('SELECT keyword FROM alert_subscriptions')){
          return {results:subscriptions.filter(row=>row.chat_id===this.args[0])};
        }
        if(sql.startsWith('SELECT chat_id,keyword FROM alert_subscriptions')){
          return {results:[...subscriptions]};
        }
        throw new Error(`all inesperado: ${sql}`);
      },
      async first(){
        if(sql.includes('FROM alert_subscriptions WHERE chat_id=?')){
          return {total:subscriptions.filter(row=>row.chat_id===this.args[0]).length};
        }
        if(sql.includes('FROM alert_deliveries WHERE chat_id=? AND sent_at>=?')){
          return {total:deliveries.filter(row=>row.chat_id===this.args[0]&&row.sent_at>=this.args[1]).length};
        }
        throw new Error(`first inesperado: ${sql}`);
      },
      async run(){
        const [a,b,c]=this.args;
        if(sql.startsWith('CREATE')) return {meta:{changes:0}};
        if(sql.startsWith('INSERT OR IGNORE INTO alert_subscriptions')){
          if(subscriptions.some(row=>row.chat_id===a&&row.keyword===b)) return {meta:{changes:0}};
          subscriptions.push({chat_id:a,keyword:b,created_at:c});return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT OR IGNORE INTO alert_deliveries')){
          if(deliveries.some(row=>row.chat_id===a&&row.offer_id===b)) return {meta:{changes:0}};
          deliveries.push({chat_id:a,offer_id:b,sent_at:c});return {meta:{changes:1}};
        }
        if(sql==='DELETE FROM alert_subscriptions WHERE chat_id=? AND keyword=?'){
          remove(subscriptions,row=>row.chat_id===a&&row.keyword===b);return {meta:{}};
        }
        if(sql==='DELETE FROM alert_subscriptions WHERE chat_id=?'){
          remove(subscriptions,row=>row.chat_id===a);return {meta:{}};
        }
        if(sql==='DELETE FROM alert_deliveries WHERE chat_id=?'){
          remove(deliveries,row=>row.chat_id===a);return {meta:{}};
        }
        if(sql==='DELETE FROM alert_deliveries WHERE sent_at<?'){
          remove(deliveries,row=>row.sent_at<a);return {meta:{}};
        }
        throw new Error(`run inesperado: ${sql}`);
      },
    };
  }
  function remove(list,predicate){for(let i=list.length-1;i>=0;i--) if(predicate(list[i])) list.splice(i,1);}
  return {
    subscriptions,deliveries,
    prepare:statement,
    async batch(statements){for(const item of statements) await item.run();return [];},
  };
}

function message(text,chatId=123,type='private') {
  return {message:{text,chat:{id:chatId,type}}};
}

test('palavras são normalizadas e casam só com palavra inteira',()=>{
  assert.equal(validKeyword('  Air Fryer! '),'air fryer');
  assert.equal(validKeyword('tv'),'');
  assert.equal(validKeyword('a b c d e'),'');
  assert.equal(titleMatches('Fritadeira Air Fryer Mondial 4L','air fryer'),true);
  assert.equal(titleMatches('Panela de pressão','pa'),false);
  assert.equal(titleMatches('Kit 2 Fones Bluetooth','fone bluetooth'),true);
  assert.deepEqual(parseCommand('/remover@TaBaratoBot air fryer'),{command:'remover',argument:'air fryer'});
  assert.deepEqual(parseCommand('cafeteira'),{command:'alerta',argument:'cafeteira'});
});

test('cria, lista, limita, remove e apaga alertas em conversa privada',async()=>{
  const DB=database(),env={DB};
  assert.match(await handleUpdate(env,message('/start')),/Alertas do Tá Barato/);
  assert.match(await handleUpdate(env,message('Air Fryer')),/air fryer/);
  await handleUpdate(env,message('Air Fryer'));
  assert.equal(DB.subscriptions.length,1);
  for(const item of ['cafeteira','fone bluetooth','tenis corrida','mochila']) await handleUpdate(env,message(item));
  assert.equal(DB.subscriptions.length,MAX_KEYWORDS_PER_CHAT);
  assert.match(await handleUpdate(env,message('notebook')),/já tem 5 alertas/);
  assert.match(await handleUpdate(env,message('/meusalertas')),/cafeteira/);
  await handleUpdate(env,message('/remover cafeteira'));
  assert.equal(DB.subscriptions.length,MAX_KEYWORDS_PER_CHAT-1);
  DB.deliveries.push({chat_id:'123',offer_id:'x',sent_at:1});
  assert.match(await handleUpdate(env,message('/parar')),/apagados/);
  assert.equal(DB.subscriptions.length,0);
  assert.equal(DB.deliveries.length,0);
});

test('ignora grupos e mensagens sem texto',async()=>{
  const DB=database(),env={DB};
  assert.equal(await handleUpdate(env,message('air fryer',-100,'group')),null);
  assert.equal(await handleUpdate(env,{message:{chat:{id:1,type:'private'}}}),null);
  assert.equal(DB.subscriptions.length,0);
});

test('avisa quem pediu a palavra uma única vez por oferta e respeita o limite diário',async()=>{
  const DB=database(),env={DB,TELEGRAM_ALERTS_BOT_TOKEN:'token'};
  await handleUpdate(env,message('air fryer',1));
  await handleUpdate(env,message('cafeteira',2));
  const calls=[];
  const fetcher=async(url,init)=>{calls.push(JSON.parse(init.body));return {status:200};};
  const offer={id:'shopee_1_2',title:'Fritadeira Air Fryer 4L',price:299.9,discount:40};
  assert.equal(await notifyOfferAlerts(env,offer,1000,fetcher),1);
  assert.equal(await notifyOfferAlerts(env,offer,1100,fetcher),0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].chat_id,'1');
  assert.match(calls[0].text,/Alerta: <b>air fryer<\/b>/);
  assert.match(calls[0].reply_markup.inline_keyboard[0][0].url,/\/oferta\/.+--shopee_1_2\?utm_source=telegram$/);
  for(let index=0;index<MAX_ALERTS_PER_DAY+2;index++){
    await notifyOfferAlerts(env,{...offer,id:`outra-${index}`},2000+index,fetcher);
  }
  assert.equal(calls.length,MAX_ALERTS_PER_DAY);
});

test('quem bloqueou o bot tem os dados apagados e sem token nada é enviado',async()=>{
  const DB=database(),env={DB,TELEGRAM_ALERTS_BOT_TOKEN:'token'};
  await handleUpdate(env,message('air fryer',7));
  const offer={id:'o1',title:'Air fryer',price:199,discount:0};
  assert.equal(await notifyOfferAlerts({DB},offer,1000,async()=>({status:200})),0);
  await notifyOfferAlerts(env,offer,1000,async()=>({status:403}));
  assert.equal(DB.subscriptions.length,0);
  assert.equal(DB.deliveries.length,0);
});

test('webhook fica fechado sem segredo e exige o cabeçalho do Telegram',async()=>{
  const DB=database();
  const request=(secret)=>new Request('https://canaltabarato.com.br/api/telegram-alerts',{method:'POST',
    headers:{'Content-Type':'application/json',...(secret?{'X-Telegram-Bot-Api-Secret-Token':secret}:{})},
    body:JSON.stringify(message('/start'))});
  assert.equal((await webhook({request:request('x'),env:{DB}})).status,503);
  const env={DB,TELEGRAM_ALERTS_BOT_TOKEN:'token',TELEGRAM_ALERTS_WEBHOOK_SECRET:'s'.repeat(32)};
  assert.equal((await webhook({request:request('errado'),env})).status,401);
  const originalFetch=globalThis.fetch;
  const sent=[];
  globalThis.fetch=async(url,init)=>{sent.push(JSON.parse(init.body));return {status:200};};
  try{
    assert.equal((await webhook({request:request('s'.repeat(32)),env})).status,200);
  }finally{globalThis.fetch=originalFetch;}
  assert.equal(sent.length,1);
  assert.match(sent[0].text,/Alertas do Tá Barato/);
});
