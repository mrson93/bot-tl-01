import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestGet,onRequestPost} from '../functions/api/stores.js';

function database(rows=[]){
  return {prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},
    async all(){assert.match(sql,/slug<>'mercadolivre'/);return {results:rows};},
    async run(){return {meta:{changes:1}};}};}};
}

test('oculta o atalho direto do Mercado Livre',async()=>{
  const response=await onRequestGet({env:{DB:database([{slug:'shopee',name:'Shopee'}])}});
  assert.deepEqual((await response.json()).stores,[{slug:'shopee',name:'Shopee'}]);
});

test('não aceita recriar o atalho direto do Mercado Livre',async()=>{
  const token='t'.repeat(32);
  const request=new Request('https://canaltabarato.com.br/api/stores',{method:'POST',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({source:'Mercado Livre',destination:'https://www.mercadolivre.com.br/'})});
  const response=await onRequestPost({request,env:{DB:database(),PUBLISH_TOKEN:token,
    ALLOWED_DESTINATION_HOSTS:'mercadolivre.com.br'}});
  assert.equal(response.status,400);
});
