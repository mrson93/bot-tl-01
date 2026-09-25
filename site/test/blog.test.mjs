import assert from 'node:assert/strict';
import test from 'node:test';
import {renderArticleBody} from '../functions/_blog.js';
import {onRequestGet as blogIndex} from '../functions/blog.js';
import {onRequestGet as adminPage} from '../functions/admin.js';
import {onRequestGet as adminPosts} from '../functions/api/admin/posts.js';
import {adminIdentity} from '../functions/_admin.js';

const base64Url=value=>Buffer.from(value).toString('base64url');

test('conteúdo editorial formata texto e bloqueia HTML arbitrário',()=>{
  const rendered=renderArticleBody('## Comparativo\n\nProduto **bom**.\n\n- Seguro\n- Barato\n\n<script>alert(1)</script>');
  assert.match(rendered,/<h2>Comparativo<\/h2>/);
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
