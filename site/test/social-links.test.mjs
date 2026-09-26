import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {head,footer} from '../functions/_site.js';

const links=[
  'https://www.facebook.com/canaltabarato',
  'https://www.instagram.com/ofertascanaltabarato/',
  'https://t.me/CanalTaBarato',
  'https://bsky.app/profile/canaltabarato.com.br',
  'https://x.com/canaltabarato'
];

test('página inicial apresenta todos os canais oficiais',async()=>{
  const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(page,/Escolha seu canal/);
  assert.ok(page.indexOf('class="social-strip"')<page.indexOf('id="vip-banner"'));
  assert.equal((page.match(/cdn\.simpleicons\.org\/(facebook|instagram|telegram|bluesky|x)/g)||[]).length,5);
  assert.doesNotMatch(page,/class="telegram-link"/);
  for(const link of links) assert.ok(page.includes(link),`link ausente: ${link}`);
});

test('atalhos das lojas usam ícones de marca',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  for(const store of ['shopee','aliexpress']) assert.ok(app.includes(`simpleicons.org/${store}/`));
  assert.ok(app.includes("amazon:'/icons/amazon.svg'"));
  assert.match(await readFile(new URL('../public/icons/amazon.svg',import.meta.url),'utf8'),/<svg/);
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
  assert.doesNotMatch(page,/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-5239970037930660/);
  assert.doesNotMatch(head({title:'Teste',description:'Teste',canonical:'https://canaltabarato.com.br/teste'}),/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
  assert.match(head({title:'Matéria',description:'Teste',canonical:'https://canaltabarato.com.br/blog/teste',ads:true}),/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-5239970037930660/);
  assert.equal(adsTxt,'google.com, pub-5239970037930660, DIRECT, f08c47fec0942fa0\n');
});

test('rodapé mantém o aviso legível e consistente nas páginas',async()=>{
  const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
  const aviso='Os preços podem mudar sem aviso. Os links podem gerar comissão para o canal, sem custo adicional para você.';
  assert.ok(page.includes(aviso));
  assert.ok(footer().includes(aviso));
  assert.match(css,/footer p\{grid-column:2;grid-row:1;/);
  assert.match(css,/@media\(max-width:800px\)\{footer \.footer-brand,footer p,footer \.footer-links,footer small\{grid-column:1;grid-row:auto\}\}/);
});
