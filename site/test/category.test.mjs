import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeCategory,label} from '../functions/_site.js';

test('categoria enviada pelo bot vale mais que palavras soltas do título',()=>{
  assert.equal(normalizeCategory('cozinha','Kit 10 Marmitas Potes para levar ao ar livre'),'cozinha');
  assert.equal(normalizeCategory('esporte','Whey'),'esportes');
  assert.equal(normalizeCategory('hidratacao','Garrafa térmica'),'cozinha');
  assert.equal(normalizeCategory('mercado','Café torrado'),'mercado');
  assert.equal(label('mercado'),'Mercado');
});

test('nomes de categoria do AliExpress e "outros" ainda passam pelo título',()=>{
  assert.equal(normalizeCategory('Consumer Electronics','Fone'),'eletronicos');
  assert.equal(normalizeCategory('Home & Garden','Vaso'),'casa');
  assert.equal(normalizeCategory('outros','Brinquedo de montar'),'infantil');
  assert.equal(normalizeCategory('outros','Produto sem pista'),'outros');
});
