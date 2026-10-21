import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {onRequestGet,services} from '../functions/servicos.js';

test('página de serviços lista os recursos reais com links próprios',async()=>{
  const response=onRequestGet({env:{TELEGRAM_ALERTS_BOT_USERNAME:'OutroBot123'}});
  assert.equal(response.status,200);
  const page=await response.text();
  for(const text of ['Canal no Telegram','Alertas por palavra-chave','Histórico de preços','Cupons ativos','Guias e comparativos','Stories no Instagram']){
    assert.ok(page.includes(text),text);
  }
  assert.ok(page.includes('https://t.me/OutroBot123?start=site'));
  assert.ok(page.includes('<link rel="canonical" href="https://canaltabarato.com.br/servicos">')||page.includes('canaltabarato.com.br/servicos'));
  assert.ok(services().flatMap(group=>group.items).every(item=>item.href&&item.title&&item.text));
});

test('menu, rodapé e página inicial apontam para os serviços',async()=>{
  const index=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const site=await readFile(new URL('../functions/_site.js',import.meta.url),'utf8');
  assert.ok(index.includes('href="/servicos"'));
  assert.ok(index.includes('services-home'));
  assert.ok(site.includes('href="/servicos"'));
});
