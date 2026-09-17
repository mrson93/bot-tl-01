import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestGet as storiesPage} from '../functions/stories.js';
import {onRequestGet as storyRedirect} from '../functions/story-go/[id].js';

test('lista ofertas dos Stories com link rastreado',async()=>{
  const rows=[{media_id:'17900000000000001',offer_id:'oferta-1',title:'Panela elétrica',price:79.9,
    published_at:Math.floor(Date.now()/1000)-60,image_url:'https://img.example/panela.jpg',shop:'Shopee',source:'Shopee'}];
  const DB={prepare(sql){return {bind(){return this;},async all(){
    assert.match(sql,/s\.published_at>=\?/);return {results:rows};
  }};}};
  const response=await storiesPage({env:{DB}}),body=await response.text();
  assert.equal(response.status,200);
  assert.match(body,/Ofertas dos Stories/);
  assert.match(body,/Panela elétrica/);
  assert.match(body,/R\$\s79,90/u);
  assert.match(body,/\/story-go\/17900000000000001/);
  assert.match(body,/Entre no canal gratuito do Telegram/);
  assert.match(body,/https:\/\/t\.me\/CanalTaBarato/);
  assert.equal(response.headers.get('cache-control'),'public, max-age=60, stale-while-revalidate=180');
});

test('mostra alternativa quando não há Story ativo',async()=>{
  const DB={prepare(){return {bind(){return this;},async all(){return {results:[]};}};}};
  const body=await (await storiesPage({env:{DB}})).text();
  assert.match(body,/Nenhum Story ativo agora/);
  assert.match(body,/\?sort=recent/);
});

test('redireciona o clique do Story e agenda a medição',async()=>{
  const statements=[];
  const DB={prepare(sql){const statement={sql,args:[],bind(...args){this.args=args;return this;},
    async first(){return {offer_id:'oferta-1',link:'https://s.shopee.com.br/produto'};},
    async run(){statements.push({sql:this.sql,args:this.args});return {meta:{changes:1}};}};return statement;}};
  let pending;
  const request=new Request('https://tabarato.com/story-go/17900000000000001',{
    headers:{'CF-Connecting-IP':'203.0.113.5','User-Agent':'test-agent'},
  });
  const response=await storyRedirect({request,env:{DB,ALLOWED_DESTINATION_HOSTS:'shopee.com.br',ABUSE_HASH_SECRET:'s'.repeat(32)},
    params:{id:'17900000000000001'},waitUntil(promise){pending=promise;}});
  await pending;
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'https://s.shopee.com.br/produto');
  assert.ok(statements.some(item=>item.sql.includes('instagram_story_clicks_daily')));
  assert.ok(statements.some(item=>item.sql.includes('INSERT INTO clicks')));
});

test('não redireciona IDs inválidos',async()=>{
  const response=await storyRedirect({env:{},params:{id:'../token'},waitUntil(){}});
  assert.equal(response.status,404);
});
