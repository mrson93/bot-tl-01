import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

function env(overrides={}) {
  return {ADMIN_TOKEN:'a'.repeat(32),PUBLIC_BASE_URL:'https://go.canaltabarato.com.br',
    ALLOWED_DESTINATION_HOSTS:'shopee.com.br',DB:{prepare(){return {bind(){return this;},
      async run(){return {meta:{changes:1}};},async first(){return null;},async all(){return {results:[]};}};}},...overrides};
}

test('recusa administração quando o segredo não está configurado',async()=>{
  const request=new Request('https://go.canaltabarato.com.br/api/stats',{headers:{Authorization:'Bearer undefined'}});
  assert.equal((await worker.fetch(request,env({ADMIN_TOKEN:''}))).status,401);
});

test('valida dimensões e cria link próprio sem dados pessoais',async()=>{
  const request=new Request('https://go.canaltabarato.com.br/api/links',{method:'POST',
    headers:{Authorization:`Bearer ${'a'.repeat(32)}`,'Content-Type':'application/json'},
    body:JSON.stringify({destination:'https://shopee.com.br/oferta',offer_id:'produto-1',channel:'Facebook',source:'Shopee'})});
  const response=await worker.fetch(request,env());
  const body=await response.json();
  assert.equal(response.status,201);
  assert.match(body.short_url,/^https:\/\/go\.canaltabarato\.com\.br\/[A-Za-z0-9]{8}$/);
});

test('mantém links antigos válidos durante a transição',async()=>{
  let selected;
  const DB={prepare(){return {bind(slug){selected=slug;return this;},
    async first(){return {destination:'https://shopee.com.br/oferta'};},
    async run(){return {meta:{changes:1}};}};}};
  const response=await worker.fetch(
    new Request('https://go.canaltabarato.com.br/abcdef0123456789'),env({DB}));
  assert.equal(response.status,302);
  assert.equal(selected,'abcdef0123456789');
});

test('rejeita destino não autorizado e intervalo inválido',async()=>{
  const link=new Request('https://go.canaltabarato.com.br/api/links',{method:'POST',
    headers:{Authorization:`Bearer ${'a'.repeat(32)}`,'Content-Type':'application/json'},
    body:JSON.stringify({destination:'https://fraude.example/x',offer_id:'1',channel:'x',source:'x'})});
  assert.equal((await worker.fetch(link,env())).status,400);
  const stats=new Request('https://go.canaltabarato.com.br/api/stats?start=20&end=10',
    {headers:{Authorization:`Bearer ${'a'.repeat(32)}`}});
  assert.equal((await worker.fetch(stats,env())).status,400);
});
