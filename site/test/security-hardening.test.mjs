import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {onRequestPost as feedback} from '../functions/api/feedback.js';
import {onRequestPost as publish} from '../functions/api/publish.js';
import {onRequestPost as view} from '../functions/api/view.js';
import {onRequestPost as searchMetric} from '../functions/api/search-metric.js';
import {onRequestGet as verifyMetaWebhook} from '../functions/api/meta-webhook.js';

function database() {
  const events=new Set();
  const state={feedbackWrites:0,metricBatches:0,searchWrites:0};
  return {state,prepare(sql){
    const statement={args:[],bind(...args){this.args=args;return this;},
      async first(){return sql.includes('FROM offers')?{ok:1}:null;},
      async run(){
        if(sql.includes('INSERT OR IGNORE INTO abuse_events')){
          const key=this.args[0],fresh=!events.has(key);events.add(key);
          return {meta:{changes:fresh?1:0}};
        }
        if(sql.includes('INSERT INTO offer_feedback')) state.feedbackWrites+=1;
        if(sql.includes('INSERT INTO catalog_search_daily')) state.searchWrites+=1;
        return {meta:{changes:1}};
      }};
    return statement;
  },async batch(){state.metricBatches+=1;return [];}};
}

function publicRequest(path,body) {
  return new Request(`https://canaltabarato.com.br${path}`,{method:'POST',headers:{
    Origin:'https://canaltabarato.com.br','Content-Type':'application/json',
    'CF-Connecting-IP':'203.0.113.10','User-Agent':'security-test',
  },body:JSON.stringify(body)});
}

test('feedback limita o corpo real mesmo sem confiar em Content-Length',async()=>{
  const request=publicRequest('/api/feedback',{offer_id:'oferta-1',kind:'expired',padding:'x'.repeat(3000)});
  assert.equal((await feedback({request,env:{}})).status,413);
});

test('publicação autenticada também limita o corpo real',async()=>{
  const request=new Request('https://canaltabarato.com.br/api/publish',{method:'POST',headers:{
    Authorization:`Bearer ${'p'.repeat(32)}`,'Content-Type':'application/json',
  },body:JSON.stringify({padding:'x'.repeat(33_000)})});
  const response=await publish({request,env:{PUBLISH_TOKEN:'p'.repeat(32)}});
  assert.equal(response.status,413);
});

test('feedback deduplica no servidor e grava uma única vez por cliente e dia',async()=>{
  const DB=database(),env={DB,ABUSE_HASH_SECRET:'s'.repeat(32)};
  const first=await feedback({request:publicRequest('/api/feedback',{offer_id:'oferta-1',kind:'expired'}),env});
  const duplicate=await feedback({request:publicRequest('/api/feedback',{offer_id:'oferta-1',kind:'expired'}),env});
  assert.equal(first.status,201);
  assert.equal(duplicate.status,202);
  assert.equal(DB.state.feedbackWrites,1);
});

test('feedback falha fechado sem o segredo de proteção contra abuso',async()=>{
  const response=await feedback({request:publicRequest('/api/feedback',{offer_id:'oferta-1',kind:'expired'}),
    env:{DB:database()}});
  assert.equal(response.status,503);
});

test('visualização exige JSON limitado e deduplica métricas',async()=>{
  const DB=database(),env={DB,ABUSE_HASH_SECRET:'s'.repeat(32)};
  const first=await view({request:publicRequest('/api/view',{path:'/',source:'direct'}),env});
  const duplicate=await view({request:publicRequest('/api/view',{path:'/',source:'direct'}),env});
  assert.equal(first.status,202);
  assert.equal(duplicate.status,202);
  assert.equal(DB.state.metricBatches,1);
});

test('busca registra só o resultado agregado e deduplica por visitante',async()=>{
  const DB=database(),env={DB,ABUSE_HASH_SECRET:'s'.repeat(32)};
  const body={source:'google',device:'mobile',outcome:'empty'};
  assert.equal((await searchMetric({request:publicRequest('/api/search-metric',body),env})).status,202);
  assert.equal((await searchMetric({request:publicRequest('/api/search-metric',body),env})).status,202);
  assert.equal(DB.state.searchWrites,1);
  assert.equal((await searchMetric({request:publicRequest('/api/search-metric',{...body,outcome:'no results'}),env})).status,400);
});

test('verificação Meta falha fechado quando secret ou token estão ausentes',async()=>{
  const base='https://canaltabarato.com.br/api/meta-webhook?hub.mode=subscribe&hub.challenge=ok';
  assert.equal((await verifyMetaWebhook({request:new Request(base),env:{}})).status,403);
  assert.equal((await verifyMetaWebhook({request:new Request(base),env:{META_WEBHOOK_VERIFY_TOKEN:'secret'}})).status,403);
  const valid=await verifyMetaWebhook({request:new Request(`${base}&hub.verify_token=secret`),
    env:{META_WEBHOOK_VERIFY_TOKEN:'secret'}});
  assert.equal(valid.status,200);
  assert.equal(await valid.text(),'ok');
});

test('relatos não removem automaticamente ofertas da vitrine',async()=>{
  const offers=await readFile(new URL('../functions/api/offers.js',import.meta.url),'utf8');
  const discovery=await readFile(new URL('../functions/_discovery.js',import.meta.url),'utf8');
  const offerPage=await readFile(new URL('../functions/oferta/[id].js',import.meta.url),'utf8');
  assert.doesNotMatch(offers,/offer_feedback[\s\S]*quantity>=5/);
  assert.doesNotMatch(discovery,/offer_feedback[\s\S]*quantity>=5/);
  assert.doesNotMatch(offerPage,/offer_feedback|reports>=/);
});
