import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequest} from '../functions/_middleware.js';

function context(url) {
  return {request:new Request(url),next:async()=>new Response('next')};
}

test('redireciona páginas do endereço antigo para o domínio oficial',async()=>{
  const response=await onRequest(context('https://canaltabarato.pages.dev/oferta/abc?q=1'));
  assert.equal(response.status,301);
  assert.equal(response.headers.get('location'),'https://canaltabarato.com.br/oferta/abc?q=1');
});

test('mantém APIs antigas durante a migração e aceita o domínio oficial',async()=>{
  assert.equal(await (await onRequest(context('https://canaltabarato.pages.dev/api/meta-webhook'))).text(),'next');
  assert.equal(await (await onRequest(context('https://canaltabarato.com.br/'))).text(),'next');
});

test('unifica www no domínio sem www',async()=>{
  const response=await onRequest(context('https://www.canaltabarato.com.br/cupons'));
  assert.equal(response.status,301);
  assert.equal(response.headers.get('location'),'https://canaltabarato.com.br/cupons');
});
