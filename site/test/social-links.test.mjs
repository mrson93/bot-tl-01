import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {footer} from '../functions/_site.js';

const links=[
  'https://www.facebook.com/canaltabarato',
  'https://www.instagram.com/ofertascanaltabarato/',
  'https://t.me/CanalTaBarato',
  'https://bsky.app/profile/canaltabarato.com.br'
];

test('página inicial apresenta todos os canais oficiais',async()=>{
  const page=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(page,/Acompanhe do seu jeito/);
  assert.match(page,/Ofertas selecionadas/);
  assert.match(page,/Quedas e histórico/);
  assert.match(page,/Cupons em destaque/);
  for(const link of links) assert.ok(page.includes(link),`link ausente: ${link}`);
});

test('rodapé das páginas dinâmicas mantém os canais oficiais acessíveis',()=>{
  const pageFooter=footer();
  for(const link of links) assert.ok(pageFooter.includes(link),`link ausente: ${link}`);
});
