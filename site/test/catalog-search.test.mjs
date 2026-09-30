import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestGet,titleSearchTerms} from '../functions/api/offers.js';

test('busca separa palavras, limita termos e escapa curingas do SQL',()=>{
  assert.deepEqual(titleSearchTerms(' Galaxy   A36 256GB '),['%Galaxy%','%A36%','%256GB%']);
  assert.deepEqual(titleSearchTerms('100%_'),['%100\\%\\_%']);
  assert.equal(titleSearchTerms('a b c d e f g h i').length,8);
});

test('catálogo procura todos os termos sem exigir que estejam juntos no título',async()=>{
  let statements=[];
  const DB={prepare(sql){return {sql,bind(...args){this.args=args;return this;}};},async batch(items){statements=items;return [
    {results:[{id:'1',title:'Samsung Galaxy A36 5G com 256GB'}]},
    {results:[{total:1,latest:0,best_discount:0}]},
    {results:[{sources:'Amazon',categories:'eletronicos'}]},
    {results:[]},
  ];}};
  const request=new Request('https://canaltabarato.com.br/api/offers?q=Galaxy+A36+256GB');
  const response=await onRequestGet({request,env:{DB}}),data=await response.json();
  assert.equal(data.total,1);
  assert.equal((statements[0].sql.match(/o\.title LIKE \?/g)||[]).length,3);
  assert.deepEqual(statements[0].args.slice(1,4),['%Galaxy%','%A36%','%256GB%']);
});
