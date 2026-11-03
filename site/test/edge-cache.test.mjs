import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequest} from '../functions/_middleware.js';

function fakeCache() {
  const store=new Map();
  return {store,async match(key){return store.get(key.url)?.clone();},async put(key,res){store.set(key.url,res);}};
}

async function call(url,{headers={},cache='public, max-age=300'}={}) {
  let hits=0;const pending=[];
  const response=await onRequest({request:new Request(url,{headers}),
    next:async()=>{hits+=1;return new Response('ok',{headers:{'Cache-Control':cache}});},
    waitUntil:promise=>pending.push(promise)});
  await Promise.all(pending);
  return {response,hits};
}

test('páginas públicas saem do cache e ignoram parâmetros de campanha',async()=>{
  globalThis.caches={default:fakeCache()};
  assert.equal((await call('https://canaltabarato.com.br/lojas/x?utm_source=telegram')).hits,1);
  assert.equal((await call('https://canaltabarato.com.br/lojas/x')).hits,0);
  assert.equal((await call('https://canaltabarato.com.br/lojas/x?utm_source=x')).hits,0);
});

test('painel, respostas privadas e pedidos autenticados nunca entram no cache',async()=>{
  globalThis.caches={default:fakeCache()};
  await call('https://canaltabarato.com.br/admin');
  assert.equal((await call('https://canaltabarato.com.br/admin')).hits,1);
  await call('https://canaltabarato.com.br/api/offers',{headers:{Cookie:'CF_Authorization=abc'}});
  assert.equal(globalThis.caches.default.store.size,0);
  await call('https://canaltabarato.com.br/api/amazon-list',{headers:{Authorization:'Bearer x'}});
  await call('https://canaltabarato.com.br/blog',{cache:'no-store'});
  assert.equal(globalThis.caches.default.store.size,0);
});
