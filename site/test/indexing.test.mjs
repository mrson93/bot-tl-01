import assert from 'node:assert/strict';
import test from 'node:test';
import {head,responseHtml} from '../functions/_site.js';
import {indexableCollection,indexableOffer,MIN_COLLECTION_OFFERS,MIN_PRICE_HISTORY_DAYS} from '../functions/_indexing.js';
import {onRequestGet as sitemap} from '../functions/sitemap.xml.js';
import {onRequestGet as offerPage} from '../functions/oferta/[id].js';
import {collectionPage} from '../functions/_collection.js';

test('oferta só entra na busca com histórico e disponibilidade confirmada',()=>{
  assert.equal(MIN_PRICE_HISTORY_DAYS,7);
  assert.equal(indexableOffer({availability:'active'},6),false);
  assert.equal(indexableOffer({availability:'active'},7),true);
  assert.equal(indexableOffer({availability:'unverified'},10),false);
  assert.equal(indexableOffer({availability:'unavailable'},10),false);
});

test('coleções com menos de três produtos ficam navegáveis mas não indexáveis',async()=>{
  assert.equal(indexableCollection(2),false);
  assert.equal(indexableCollection(3),true);
  const DB={prepare(sql){return {bind(){return this;},async all(){
    if(sql.includes('SELECT DISTINCT shop value'))return {results:[{value:'Loja A'}]};
    return {results:[{id:'a',title:'Produto A',price:10,image_url:'https://example.com/a.jpg',source:'Amazon',category:'outros',shop:'Loja A'}]};
  }};}};
  const page=await collectionPage({DB},'shop','loja-a');
  assert.equal(page.headers.get('X-Robots-Tag'),'noindex, follow');
  assert.match(await page.text(),/Produto A/);
});

test('metatag e cabeçalho HTTP concordam quando uma oferta não deve ser indexada',()=>{
  assert.match(head({title:'Oferta',description:'Descrição',canonical:'https://canaltabarato.com.br/oferta/a',indexable:false}),/name="robots" content="noindex,follow"/);
  assert.equal(responseHtml('oferta',200,undefined,false).headers.get('X-Robots-Tag'),'noindex, follow');
  assert.equal(responseHtml('guia').headers.get('X-Robots-Tag'),'index, follow, max-image-preview:large');
  assert.equal(responseHtml('não encontrado',404).headers.get('X-Robots-Tag'),'noindex, nofollow');
});

test('oferta nova continua comprável, mas só é indexável após sete observações',async()=>{
  const offer={id:'amazon_ABC123',title:'Produto de teste',price:100,discount:10,image_url:'https://example.com/p.jpg',
    source:'Amazon',category:'eletronicos',shop:'Loja',published_at:1_780_000_000,last_checked_at:1_780_000_000,availability:'active'};
  async function render(days){
    const prices=Array.from({length:days},(_,index)=>({price:100-index,observed_at:1_780_000_000+index*86400}));
    const DB={prepare(){return {bind(){return this;},async first(){return offer;}};},async batch(){return [{results:prices},{results:[]}];}};
    return offerPage({params:{id:offer.id},env:{DB}});
  }
  const fresh=await render(1),mature=await render(7);
  assert.equal(fresh.headers.get('X-Robots-Tag'),'noindex, follow');
  assert.match(await fresh.text(),/href="\/go\/amazon_ABC123"/);
  assert.equal(mature.headers.get('X-Robots-Tag'),'index, follow, max-image-preview:large');
  assert.match(await mature.text(),/name="robots" content="index,follow/);
});

test('sitemap exige o mesmo histórico mínimo das páginas de oferta',async()=>{
  let offerQuery,collectionQueries=[];
  const env={DB:{prepare(sql){if(sql.includes('FROM offers o'))offerQuery=sql;
    if(sql.includes('GROUP BY category')||sql.includes('GROUP BY shop'))collectionQueries.push(sql);
    return {
    bind(...values){if(sql.includes('FROM offers o'))assert.equal(values[1],MIN_PRICE_HISTORY_DAYS);
      else assert.equal(values[0],MIN_COLLECTION_OFFERS);return this;},
    async all(){return {results:[]};},
  };}}};
  const result=await sitemap({env});
  assert.equal(result.status,200);
  assert.match(offerQuery,/o\.availability='active'/);
  assert.match(offerQuery,/offer_prices p/);
  assert.match(offerQuery,/COUNT\(\*\)/);
  assert.equal(collectionQueries.length,2);
  for(const query of collectionQueries)assert.match(query,/HAVING COUNT\(\*\)>=\?/);
});
