import assert from 'node:assert/strict';
import test from 'node:test';
import {cachedJson} from '../functions/_cache_json.js';
import {outrasLojasNoCatalogo} from '../functions/_compare_stores.js';

function fakeCache(){
  const store=new Map();
  return {store,async match(req){return store.get(req.url)?.clone();},async put(req,res){store.set(req.url,res);}};
}

test('cota do D1: o resultado fica no cache e a consulta roda uma vez só',async()=>{
  const cache=fakeCache();let consultas=0;
  const produzir=async()=>{consultas++;return [{value:'Loja X'}];};
  assert.deepEqual(await cachedJson('collection-values:shop',3600,produzir,cache),[{value:'Loja X'}]);
  assert.deepEqual(await cachedJson('collection-values:shop',3600,produzir,cache),[{value:'Loja X'}]);
  assert.equal(consultas,1);
  assert.match([...cache.store.values()][0].headers.get('Cache-Control'),/max-age=3600/);
  // Sem cache (teste local), consulta direto.
  assert.deepEqual(await cachedJson('x',60,async()=>5,null),5);
  // Cache que falha não derruba a página.
  const quebrado={async match(){throw new Error('x');},async put(){throw new Error('y');}};
  assert.equal(await cachedJson('x',60,async()=>7,quebrado),7);
});

test('cota do D1: "outras lojas" procura só na categoria da oferta',async()=>{
  const sqls=[];
  const env={DB:{prepare(sql){return {args:[],bind(...a){this.args=a;sqls.push([sql,a]);return this;},async all(){return {results:[]};}};}}};
  await outrasLojasNoCatalogo(env,{id:'shopee_1_2',source:'Shopee',price:100,category:'eletronicos',title:'Fone Bluetooth JBL Tune 520BT Preto'});
  assert.match(sqls[0][0],/WHERE category=\? AND availability/);
  assert.equal(sqls[0][1][0],'eletronicos');
  await outrasLojasNoCatalogo(env,{id:'shopee_1_2',source:'Shopee',price:100,category:'outros',title:'Fone Bluetooth JBL Tune 520BT Preto'});
  assert.doesNotMatch(sqls[1][0],/category=\?/);
});
