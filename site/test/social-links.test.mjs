import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {head} from '../functions/_site.js';

const links=[
  'https://www.facebook.com/canaltabarato',
  'https://www.instagram.com/ofertascanaltabarato/',
  'https://t.me/CanalTaBarato',
  'https://bsky.app/profile/canaltabarato.com.br'
];

test('página inicial apresenta todos os canais oficiais',async()=>{
  const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(page,/Escolha seu canal/);
  assert.ok(page.indexOf('class="social-strip"')<page.indexOf('id="vip-banner"'));
  assert.equal((page.match(/cdn\.simpleicons\.org\/(facebook|instagram|telegram|bluesky)/g)||[]).length,4);
  assert.doesNotMatch(page,/class="telegram-link"/);
  for(const link of links) assert.ok(page.includes(link),`link ausente: ${link}`);
});

test('atalhos das lojas usam ícones de marca',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  for(const store of ['shopee','aliexpress','amazon']) assert.ok(app.includes(`simpleicons.org/${store}/`));
});

test('reserva somente dois espaços discretos para publicidade',async()=>{
  const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.equal((page.match(/class="ad-placement"/g)||[]).length,2);
  assert.doesNotMatch(page,/popup|interstitial|vignette/i);
});

test('publica a identificação oficial do AdSense',async()=>{
  const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const adsTxt=await readFile(new URL('../public/ads.txt',import.meta.url),'utf8');
  assert.match(page,/google-adsense-account" content="ca-pub-5239970037930660"/);
  assert.match(head({title:'Teste',description:'Teste',canonical:'https://canaltabarato.com.br/teste'}),/google-adsense-account" content="ca-pub-5239970037930660"/);
  assert.equal(adsTxt,'google.com, pub-5239970037930660, DIRECT, f08c47fec0942fa0\n');
});
