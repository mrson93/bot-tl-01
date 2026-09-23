import assert from 'node:assert/strict';
import test from 'node:test';
import {productStructuredData} from '../functions/_site.js';

const base={
  id:'amazon_B07W8X4F48',title:'Mouse gamer '.repeat(30),price:349.9,
  image_url:'https://example.com/mouse.jpg',source:'Amazon',shop:'Logitech G',
  category:'eletronicos',published_at:1789992000,last_checked_at:1789995600,
  availability:'available',
};

test('produto usa nome válido, ASIN, marca e início real da oferta',()=>{
  const data=productStructuredData(base,'https://canaltabarato.com.br/oferta/mouse--amazon_B07W8X4F48');
  const product=data['@graph'][0];
  assert.ok(product.name.length<=150);
  assert.equal(product.sku,'B07W8X4F48');
  assert.equal(product.brand.name,'Logitech G');
  assert.equal(product.offers.validFrom,new Date(base.published_at*1000).toISOString());
});

test('não inventa marca nem avaliação quando a fonte não fornece os dados',()=>{
  const data=productStructuredData({...base,id:'mercadolivre_MLB123',source:'Mercado Livre',shop:'Loja X'},'https://canaltabarato.com.br/oferta/x');
  const product=data['@graph'][0];
  assert.equal(product.sku,'MLB123');
  assert.equal(product.brand,undefined);
  assert.equal(product.review,undefined);
  assert.equal(product.aggregateRating,undefined);
  assert.equal(product.offers.shippingDetails,undefined);
  assert.equal(product.offers.hasMerchantReturnPolicy,undefined);
});
