import assert from 'node:assert/strict';
import test from 'node:test';
import {productStructuredData} from '../functions/_site.js';

const base={
  id:'amazon_B07W8X4F48',title:'Mouse gamer '.repeat(30),price:349.9,
  image_url:'https://example.com/mouse.jpg',source:'Amazon',shop:'Logitech G',
  category:'eletronicos',published_at:1789992000,last_checked_at:1789995600,
  availability:'available',
};

test('produto usa marcação de agregador com nome, ASIN, marca e preço válidos',()=>{
  const data=productStructuredData(base,'https://canaltabarato.com.br/oferta/mouse--amazon_B07W8X4F48');
  const product=data['@graph'][0];
  assert.ok(product.name.length<=150);
  assert.equal(product.sku,'B07W8X4F48');
  assert.equal(product.brand.name,'Logitech G');
  assert.equal(product.category,'Eletrônicos');
  assert.equal(product.offers['@type'],'AggregateOffer');
  assert.equal(product.offers.lowPrice,349.9);
  assert.equal(product.offers.highPrice,349.9);
  assert.equal(product.offers.offerCount,1);
  assert.equal(product.offers.priceCurrency,'BRL');
});

test('não se declara vendedor nem inventa marca, avaliação, frete ou devolução',()=>{
  const data=productStructuredData({...base,id:'mercadolivre_MLB123',source:'Mercado Livre',shop:'Loja X'},'https://canaltabarato.com.br/oferta/x');
  const product=data['@graph'][0];
  assert.equal(product.sku,'MLB123');
  assert.equal(product.brand,undefined);
  assert.equal(product.review,undefined);
  assert.equal(product.aggregateRating,undefined);
  assert.equal(product.offers.url,undefined);
  assert.equal(product.offers.seller,undefined);
  assert.equal(product.offers.availability,undefined);
  assert.equal(product.offers.validFrom,undefined);
  assert.equal(product.offers.priceValidUntil,undefined);
  assert.equal(product.offers.shippingDetails,undefined);
  assert.equal(product.offers.hasMerchantReturnPolicy,undefined);
});
