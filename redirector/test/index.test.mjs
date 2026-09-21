import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

function env(overrides={}) {
  return {ADMIN_TOKEN:'a'.repeat(32),PUBLIC_BASE_URL:'https://go.canaltabarato.com.br',
    ABUSE_HASH_SECRET:'b'.repeat(32),ALLOWED_DESTINATION_HOSTS:'shopee.com.br',DB:{prepare(){return {bind(){return this;},
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
  assert.match(body.short_url,/^https:\/\/go\.canaltabarato\.com\.br\/[a-z2-9]{8}$/);
});

test('aceita destino oficial do Mercado Livre',async()=>{
  const request=new Request('https://go.canaltabarato.com.br/api/links',{method:'POST',
    headers:{Authorization:`Bearer ${'a'.repeat(32)}`,'Content-Type':'application/json'},
    body:JSON.stringify({destination:'https://www.mercadolivre.com.br/produto',offer_id:'MLB1',
      channel:'Instagram Stories',source:'Mercado Livre'})});
  const response=await worker.fetch(request,env({ALLOWED_DESTINATION_HOSTS:'mercadolivre.com.br,meli.la'}));
  assert.equal(response.status,201);
});

test('mantém links antigos válidos durante a transição',async()=>{
  let selected;
  const DB={prepare(sql){return {bind(slug){if(sql.includes('SELECT destination')) selected=slug;return this;},
    async first(){return {destination:'https://shopee.com.br/oferta'};},
    async run(){return {meta:{changes:1}};}};}};
  const response=await worker.fetch(
    new Request('https://go.canaltabarato.com.br/abcdef0123456789'),env({DB}));
  assert.equal(response.status,302);
  assert.equal(selected,'abcdef0123456789');
});

test('deduplica cliques repetidos sem impedir o redirecionamento',async()=>{
  const events=new Set();let clicks=0;
  const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},
    async first(){return {destination:'https://shopee.com.br/oferta'};},
    async run(){
      if(sql.includes('INSERT OR IGNORE INTO abuse_events')){
        const fresh=!events.has(this.args[0]);events.add(this.args[0]);return {meta:{changes:fresh?1:0}};
      }
      if(sql.includes('INSERT INTO clicks')) clicks+=1;
      return {meta:{changes:1}};
    }};}};
  const request=()=>new Request('https://go.canaltabarato.com.br/abcdefgh',{headers:{
    'CF-Connecting-IP':'203.0.113.10','User-Agent':'test',
  }});
  assert.equal((await worker.fetch(request(),env({DB}))).status,302);
  assert.equal((await worker.fetch(request(),env({DB}))).status,302);
  assert.equal(clicks,1);
});

test('limita o corpo real da criação de link',async()=>{
  const request=new Request('https://go.canaltabarato.com.br/api/links',{method:'POST',
    headers:{Authorization:`Bearer ${'a'.repeat(32)}`,'Content-Type':'application/json'},
    body:JSON.stringify({destination:'https://shopee.com.br/x',offer_id:'1',channel:'x',
      source:'x',padding:'x'.repeat(17_000)})});
  assert.equal((await worker.fetch(request,env())).status,413);
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

test('relatório cruza loja e canal sem guardar dados pessoais',async()=>{
  const DB={prepare(sql){return {bind(){return this;},async all(){
    if(sql.includes('GROUP BY l.channel,l.source')) return {results:[
      {channel:'Telegram',source:'Amazon',quantity:2},
      {channel:'X',source:'Mercado Livre',quantity:1},
    ]};
    return {results:[{offer_id:'amazon_A123',quantity:2}]};
  }};}};
  const request=new Request('https://go.canaltabarato.com.br/api/stats?start=1&end=2',
    {headers:{Authorization:`Bearer ${'a'.repeat(32)}`}});
  const body=await (await worker.fetch(request,env({DB}))).json();
  assert.deepEqual(body.by_channel_source,{
    Amazon:{Telegram:2},'Mercado Livre':{X:1},
  });
  assert.equal(JSON.stringify(body).includes('ip'),false);
});
