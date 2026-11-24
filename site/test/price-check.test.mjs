import assert from 'node:assert/strict';
import test from 'node:test';
import {offerCard,priceCheck,priceCheckHtml} from '../functions/_site.js';

const agora=1_800_000_000, H=3600;

test('preço conferido: três níveis pela última leitura que deu certo',()=>{
  assert.deepEqual(priceCheck({last_seen_at:agora-3*H},agora),{level:'fresh',text:'✓ Preço conferido há 3 h'});
  assert.deepEqual(priceCheck({last_seen_at:agora-50*H},agora),{level:'ok',text:'✓ Preço conferido há 2 dias'});
  assert.deepEqual(priceCheck({last_seen_at:agora-5*24*H},agora),{level:'stale',text:'⚠ Conferido há 5 dias · pode ter mudado'});
  // A tentativa que falhou (last_checked_at recente) não conta como conferido.
  assert.equal(priceCheck({last_checked_at:agora-60,last_seen_at:agora-4*24*H},agora).level,'stale');
  // Oferta antiga sem leitura: usa a publicação.
  assert.equal(priceCheck({published_at:agora-2*H},agora).level,'fresh');
  assert.equal(priceCheck({},agora).text,'Preço ainda não conferido');
});

test('preço conferido aparece no cartão, logo abaixo do preço',()=>{
  const html=offerCard({id:'shopee_1',title:'Fone',price:99.9,original_price:149.9,discount:33,image_url:'https://x/a.jpg',
    source:'Shopee',last_seen_at:Math.floor(Date.now()/1000)-2*H});
  assert.match(html,/<span class="was">[^<]+<\/span><\/div><p class="price-check check-fresh"[^>]*>✓ Preço conferido há 2 h<\/p>/);
  assert.doesNotMatch(html,/<time title="Preço consultado/);
  assert.match(priceCheckHtml({last_seen_at:agora},'span',agora),/^<span class="price-check check-fresh"/);
});
