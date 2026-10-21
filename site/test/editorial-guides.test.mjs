import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestPost as guides} from '../functions/api/editorial-guides.js';

const TOKEN='t'.repeat(32);

function database() {
  const batches=[];
  return {
    batches,
    prepare(sql){
      return {sql,args:[],
        bind(...args){this.args=args;return this;},
        async run(){return {meta:{changes:0}};},
        async all(){return sql.startsWith('PRAGMA')?{results:[{name:'price_checked_at'}]}:{results:[]};},
        async first(){return null;},
      };
    },
    async batch(statements){batches.push(statements.map(item=>({sql:item.sql,args:item.args})));return [];},
  };
}

function request(body,token=TOKEN) {
  return new Request('https://canaltabarato.com.br/api/editorial-guides',{method:'POST',
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify(body)});
}

const product=index=>({id:`p${index}`,name:`Air Fryer Modelo ${index}`,image_url:`https://cf.shopee.com.br/${index}.jpg`,
  price_label:'R$ 299,90',specs:{'Avaliação':'4,8 de 5'},links:[{store:'outro',label:'Ver na Shopee',affiliate_url:`https://s.shopee.com.br/${index}`}]});

const guide={topic:'melhor-air-fryer-ate-600-reais',slug:'melhor-air-fryer-ate-600-reais',
  title:'Melhor air fryer até R$ 600',excerpt:'Comparamos 4 air fryers.',body_markdown:'## Resposta rápida\n\n- Teste',
  category:'Guia de compra',status:'published',products:[1,2,3,4].map(product)};

test('guia automático exige o token de publicação e uma pauta válida',async()=>{
  const env={DB:database(),PUBLISH_TOKEN:TOKEN};
  assert.equal((await guides({request:request(guide,'errado'),env,waitUntil(){}})).status,401);
  assert.equal((await guides({request:request({...guide,topic:'../admin'}),env,waitUntil(){}})).status,400);
  assert.equal((await guides({request:request({...guide,products:[product(1)]}),env,waitUntil(){}})).status,400);
});

test('guia sem produtos aptos pode ser arquivado só pelo token de publicação',async()=>{
  const runs=[];
  const DB={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async run(){runs.push({sql,args:this.args});return {meta:{changes:1}};}};}};
  const archived={topic:'melhor-power-bank-ate-150-reais',status:'archived'};
  assert.equal((await guides({request:request(archived,'errado'),env:{DB,PUBLISH_TOKEN:TOKEN}})).status,401);
  const response=await guides({request:request(archived),env:{DB,PUBLISH_TOKEN:TOKEN}});
  assert.equal(response.status,200);
  assert.equal(runs.length,1);
  assert.match(runs[0].sql,/SET status='archived'/);
  assert.equal(runs[0].args[1],'guia-auto-melhor-power-bank-ate-150-reais');
});

test('guia é gravado com id próprio, publicado e sem tocar em matérias do painel',async()=>{
  const DB=database(),pending=[],pings=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(url)=>{pings.push(String(url));return {ok:true,status:200};};
  let response;
  try{
    response=await guides({request:request({...guide,id:'materia-manual'}),env:{DB,PUBLISH_TOKEN:TOKEN},waitUntil(promise){pending.push(promise);}});
    await Promise.all(pending);
  }finally{globalThis.fetch=originalFetch;}
  assert.deepEqual(pings,['https://api.indexnow.org/indexnow']);
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.id,'guia-auto-melhor-air-fryer-ate-600-reais');
  assert.equal(body.status,'published');
  const insert=DB.batches[0].find(item=>item.sql.includes('INSERT INTO blog_posts'));
  assert.equal(insert.args[0],'guia-auto-melhor-air-fryer-ate-600-reais');
  assert.equal(insert.args[7],'published');
  const products=DB.batches[0].filter(item=>item.sql.includes('INSERT INTO blog_post_products'));
  assert.equal(products.length,4);
  assert.equal(pending.length,1);
});
