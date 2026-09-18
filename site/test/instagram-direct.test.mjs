import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractInboundEvents,
  formatOfferMessage,
  processInboundEvent,
  verifyMetaSignature,
} from '../functions/_instagram_dm.js';

test('aceita assinatura HMAC da Meta e rejeita assinatura alterada',async()=>{
  const body=new TextEncoder().encode('{"object":"instagram"}');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('segredo'),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signed=new Uint8Array(await crypto.subtle.sign('HMAC',key,body));
  const hex=[...signed].map(value=>value.toString(16).padStart(2,'0')).join('');
  assert.equal(await verifyMetaSignature(body,`sha256=${hex}`,'segredo'),true);
  assert.equal(await verifyMetaSignature(body,`sha256=${'0'.repeat(64)}`,'segredo'),false);
});

test('qualquer resposta ao Story e a palavra QUERO acionam o fluxo',()=>{
  const payload={object:'instagram',entry:[{id:'17841435020643780',messaging:[
    {sender:{id:'pessoa-1'},message:{mid:'mensagem-1',text:'🔥',reply_to:{mid:'17900000000000001'}}},
    {sender:{id:'pessoa-2'},message:{mid:'mensagem-2',text:'Eu quero o link'}},
    {sender:{id:'pessoa-3'},message:{mid:'mensagem-3',text:'Olá'}},
    {sender:{id:'conta'},message:{mid:'eco',text:'enviado',is_echo:true}},
  ]}]};
  const events=extractInboundEvents(payload,'17841435020643780');
  assert.equal(events.length,2);
  assert.equal(events[0].isStoryReply,true);
  assert.deepEqual(events[0].storyIds,['17900000000000001']);
  assert.equal(events[1].keyword,true);
});

test('aceita mensagens entregues pelo objeto page apenas para IDs configurados',()=>{
  const payload={object:'page',entry:[{id:'111695315138976',messaging:[
    {sender:{id:'pessoa-1'},message:{mid:'mensagem-page-1',text:'uhuu',reply_to:{mid:'17900000000000001'}}},
  ]}]};
  const expectedIds=['17841435020643780','111695315138976'];
  assert.equal(extractInboundEvents(payload,expectedIds).length,1);
  assert.equal(extractInboundEvents({...payload,entry:[{...payload.entry[0],id:'outra-pagina'}]},expectedIds).length,0);
});

test('envia título, preço e link uma única vez',async()=>{
  const seen=new Set();
  const story={media_id:'17900000000000001',title:'Panela elétrica',price:79.9,
    link:'https://s.shopee.com.br/oferta-instagram'};
  const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},
    async first(){return story;},
    async run(){
      if(sql.includes('INSERT OR IGNORE')){
        if(seen.has(this.args[0])) return {meta:{changes:0}};
        seen.add(this.args[0]);return {meta:{changes:1}};
      }
      if(sql.startsWith('DELETE')) seen.delete(this.args[0]);
      return {meta:{changes:1}};
    }};}};
  const env={DB,ALLOWED_DESTINATION_HOSTS:'shopee.com.br',META_PAGE_ID:'111695315138976',
    META_PAGE_ACCESS_TOKEN:'token',META_GRAPH_API_VERSION:'v26.0'};
  const calls=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200};};
  try{
    const event={senderId:'pessoa-1',messageId:'mensagem-1',storyIds:[story.media_id],
      isStoryReply:true,keyword:false};
    assert.equal(await processInboundEvent(env,event,1_800_000_000),'sent');
    assert.equal(await processInboundEvent(env,event,1_800_000_001),'duplicate');
  }finally{globalThis.fetch=originalFetch;}
  assert.equal(calls.length,1);
  const sent=JSON.parse(calls[0].options.body);
  assert.match(sent.message.text,/Panela elétrica/);
  assert.match(sent.message.text,/R\$ 79,90/);
  assert.match(sent.message.text,/https:\/\/s\.shopee\.com\.br\/oferta-instagram/);
  assert.equal(sent.recipient.id,'pessoa-1');
});

test('formatação não expõe dados do usuário',()=>{
  const text=formatOfferMessage({title:'Fone',price:49.5,link:'https://example.com/x'});
  assert.equal(text,'🔥 Aqui está a oferta que você pediu!\n\n🛍️ Fone\n💰 Preço visto: R$ 49,50\n\n👉 #ad · Ver oferta: https://example.com/x\n\n⚠️ Preço e estoque podem mudar. Confira na loja antes de finalizar.');
});
