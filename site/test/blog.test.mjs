import assert from 'node:assert/strict';
import test from 'node:test';
import {articleSidebarAd,articleTableOfContents,comparisonTable,editorialComparisonTable,editorialProductCard,extractProductSpecs,renderArticleBody} from '../functions/_blog.js';
import {onRequestGet as blogIndex} from '../functions/blog.js';
import {onRequestGet as adminPage} from '../functions/admin.js';
import {onRequestGet as adminPosts} from '../functions/api/admin/posts.js';
import {adminIdentity} from '../functions/_admin.js';
import {brazilDateKey,buildComparisonDraft,comparisonType,selectComparableOffers} from '../functions/_blog_draft.js';
import {onRequestPost as automaticDraft} from '../functions/api/blog-drafts.js';

const base64Url=value=>Buffer.from(value).toString('base64url');

test('conteúdo editorial formata texto e bloqueia HTML arbitrário',()=>{
  const rendered=renderArticleBody('## Comparativo\n\nProduto **bom**.\n\n- Seguro\n- Barato\n\n<script>alert(1)</script>');
  assert.match(rendered,/<h2 id="comparativo">Comparativo<\/h2>/);
  assert.match(rendered,/<strong>bom<\/strong>/);
  assert.match(rendered,/<ul><li>Seguro<\/li><li>Barato<\/li><\/ul>/);
  assert.doesNotMatch(rendered,/<script>/);
  assert.match(rendered,/&lt;script&gt;/);
});

test('conteúdo editorial insere apenas blocos cadastrados',()=>{
  const rendered=renderArticleBody('Texto.\n\n{{offer:abc}}\n\n{{offer:desconhecida}}',{
    '{{offer:abc}}':'<aside>Oferta segura</aside>',
  });
  assert.match(rendered,/<aside>Oferta segura<\/aside>/);
  assert.match(rendered,/\{\{offer:desconhecida\}\}/);
});

test('sumário aponta para títulos e subtítulos com IDs estáveis',()=>{
  const markdown='## Como escolher\n\n### Tela\n\n## Comparativo';
  const toc=articleTableOfContents(markdown),body=renderArticleBody(markdown);
  assert.match(toc,/href="#como-escolher"/);assert.match(toc,/href="#tela"/);
  assert.match(body,/id="como-escolher"/);assert.match(body,/id="tela"/);
});

test('tabela prioriza especificações e mantém preço apenas como referência',()=>{
  const specs=extractProductSpecs('Power Bank 20000mAh 33W USB-C Bluetooth 5.3');
  assert.deepEqual(specs,{battery:'20000 mAh',power:'33 W',features:'Bluetooth 5.3, USB-C'});
  const table=comparisonTable([
    {id:'a',title:'Power Bank 20000mAh 33W USB-C',price:120,discount:40,rating:4.8,sales:1500,shop:'Loja A',source:'Shopee'},
    {id:'b',title:'Power Bank 5000 mAh sem fio',price:70,discount:0,rating:null,sales:null,shop:'Loja B',source:'Mercado Livre'},
  ]);
  assert.match(table,/Capacidade/);assert.match(table,/Potência/);assert.match(table,/Recursos/);
  assert.match(table,/20000 mAh/);assert.match(table,/33 W/);assert.match(table,/Sem fio/);
  assert.match(table,/R\$\s*70,00/);assert.match(table,/Preço de referência/);assert.match(table,/Pode mudar/);
  assert.match(table,/data-label="Capacidade"/);assert.match(table,/Ver produto/);
  assert.doesNotMatch(table,/Menor preço|Nota e vendas|<th>Desconto<\/th>/);
  assert.match(table,/Não informado/);assert.match(table,/Confirme a ficha completa/);
});

test('extrai especificações técnicas relevantes de calçados',()=>{
  assert.deepEqual(extractProductSpecs('Tênis corrida maratona malha respirável placa de carbono'),{
    purpose:'Corrida, Maratona',upper:'Malha/mesh, Respirável',sole:'Placa de carbono anunciada',
  });
});

test('produto editorial aceita link afiliado fora do catálogo de ofertas',()=>{
  const product={id:'celular-a',name:'Celular A',brand:'Marca',summary:'Bom para fotos.',image_url:'https://img.example/a.jpg',affiliate_url:'https://amazon.com.br/dp/abc?tag=canaltabarato-20',price_label:'Até R$ 2.000',specs:{Tela:'6,5 polegadas',Memória:'256 GB'}};
  const card=editorialProductCard(product),table=editorialComparisonTable([product]);
  assert.match(card,/Bom para fotos/);assert.match(card,/amazon\.com\.br\/dp\/abc\?tag=canaltabarato-20/);
  assert.match(table,/Tela/);assert.match(table,/6,5 polegadas/);assert.match(table,/Até R\$ 2\.000/);
  assert.doesNotMatch(`${card}${table}`,/\/go\//);
});

test('matéria reserva um único anúncio lateral responsivo e discreto',()=>{
  const ad=articleSidebarAd();
  assert.match(ad,/article-ad-sidebar/);assert.match(ad,/Publicidade/);
  assert.match(ad,/data-ad-slot="3688125182"/);assert.match(ad,/data-ad-format="auto"/);
  assert.doesNotMatch(ad,/<script|style=/);
});

test('automação escolhe produtos comparáveis e cria somente rascunho factual',()=>{
  const offers=[
    {id:'a',title:'Power Bank 10000 mAh',price:80,discount:20,rating:4.8,sales:900,shop:'Loja A',image_url:'https://img/a.jpg',category:'eletronicos',last_checked_at:30},
    {id:'b',title:'Carregador portátil 20000 mAh',price:110,discount:35,rating:4.6,sales:500,shop:'Loja B',image_url:'https://img/b.jpg',category:'eletronicos',last_checked_at:20},
    {id:'c',title:'Power Bank compacto',price:60,discount:10,rating:4.4,sales:200,shop:'Loja C',image_url:'https://img/c.jpg',category:'eletronicos',last_checked_at:10},
    {id:'x',title:'Fone Bluetooth',price:30,last_checked_at:40},
  ];
  assert.equal(comparisonType('Smart TV 50 polegadas'),'televisor');
  const selected=selectComparableOffers(offers);
  assert.equal(selected.type,'power-bank');
  assert.equal(selected.offers.length,3);
  const draft=buildComparisonDraft(selected.type,selected.offers,new Date('2026-09-25T12:00:00Z'));
  assert.equal(draft.status,'draft');
  assert.deepEqual(new Set(draft.offer_ids),new Set(['a','b','c']));
  assert.match(draft.body_markdown,/## Qual produto se destaca\?/);
  assert.match(draft.body_markdown,/## Como escolher power banks/);
  assert.match(draft.body_markdown,/### Análise das especificações técnicas/);
  assert.match(draft.body_markdown,/## Como fizemos este comparativo/);
  assert.match(draft.body_markdown,/## Perguntas frequentes/);
  assert.match(draft.body_markdown,/\{\{comparison-table\}\}/);
  assert.match(draft.body_markdown,/não realizamos teste físico/i);
  assert.doesNotMatch(draft.body_markdown,/excelente qualidade|testamos|recomendamos sem ressalvas/i);
  assert.doesNotMatch(draft.body_markdown,/oferta|preço|desconto|vendas informadas/i);
  assert.match(draft.slug,/comparativo-produtos/);
  assert.equal(brazilDateKey(new Date('2026-09-26T01:30:00Z')),'2026-09-25');
});

test('classificador não confunde acessórios com os produtos comparados',()=>{
  assert.equal(comparisonType('Arara com sapateira e suporte para roupas e tênis'),null);
  assert.equal(comparisonType('Cadarço elástico para tênis de corrida'),null);
  assert.equal(comparisonType('Tênis de corrida em malha respirável'),'tênis');
  assert.equal(comparisonType('Tênis para meia maratona com palmilha macia'),'tênis');
  assert.equal(comparisonType('Capa com teclado para tablet'),null);
  assert.equal(comparisonType('Tablet 11 polegadas 128GB'),'tablet');
});

test('blog abre com estado vazio antes da primeira matéria',async()=>{
  const env={DB:{prepare(){throw new Error('table missing');}}};
  const response=await blogIndex({env});
  assert.equal(response.status,200);
  const body=await response.text();
  assert.match(body,/primeiras matérias estão sendo preparadas/);
  assert.match(body,/href="\/blog" aria-current="page"/);
});

test('painel e API administrativa falham fechados sem Cloudflare Access',async()=>{
  const request=new Request('https://canaltabarato.com.br/admin');
  const page=await adminPage({request,env:{}});
  assert.equal(page.status,401);
  assert.match(page.headers.get('X-Robots-Tag'),/noindex/);
  const api=await adminPosts({request,env:{}});
  assert.equal(api.status,401);
  const automation=await automaticDraft({request:new Request('https://canaltabarato.com.br/api/blog-drafts',{method:'POST'}),env:{}});
  assert.equal(automation.status,401);
});

test('geração automática por ofertas permanece desativada',async()=>{
  const response=await automaticDraft({request:new Request('https://canaltabarato.com.br/api/blog-drafts',{method:'POST',headers:{Authorization:'Bearer segredo'}}),env:{PUBLISH_TOKEN:'segredo'}});
  assert.equal(response.status,410);assert.equal((await response.json()).reason,'editorial_topic_required');
});

test('painel valida assinatura, audiência e e-mail do Cloudflare Access',async()=>{
  const {privateKey,publicKey}=await crypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
  },true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',publicKey);jwk.kid='teste';
  const now=Math.floor(Date.now()/1000),header=base64Url(JSON.stringify({alg:'RS256',kid:'teste'}));
  const payload=base64Url(JSON.stringify({iss:'https://equipe.cloudflareaccess.com',aud:['aud-blog'],email:'editor@example.com',nbf:now-10,exp:now+300}));
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(`${header}.${payload}`));
  const token=`${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
  const previousFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({keys:[jwk]});
  try {
    const request=new Request('https://canaltabarato.com.br/admin',{headers:{'Cf-Access-Jwt-Assertion':token}});
    const identity=await adminIdentity(request,{CF_ACCESS_TEAM_DOMAIN:'equipe.cloudflareaccess.com',CF_ACCESS_AUD:'aud-blog',ADMIN_EMAILS:'editor@example.com'});
    assert.equal(identity.email,'editor@example.com');
    assert.equal(await adminIdentity(request,{CF_ACCESS_TEAM_DOMAIN:'equipe.cloudflareaccess.com',CF_ACCESS_AUD:'outra',ADMIN_EMAILS:'editor@example.com'}),null);
  } finally {globalThis.fetch=previousFetch;}
});
