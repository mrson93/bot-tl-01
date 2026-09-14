import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestGet} from '../functions/[slug].js';

test('atalho no domínio principal encaminha para o redirecionador',async()=>{
  const response=onRequestGet({params:{slug:'A7kP3mQ9'},next(){throw new Error('não deveria continuar');}});
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'https://go.canaltabarato.com.br/A7kP3mQ9');
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('nomes comuns continuam para as páginas normais do site',async()=>{
  const expected=new Response('site');
  const response=onRequestGet({params:{slug:'styles.css'},next(){return expected;}});
  assert.equal(response,expected);
});
