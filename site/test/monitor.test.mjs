import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestGet,onRequestPost} from '../functions/api/monitor.js';

// D1 mínimo: registra os comandos e devolve resultados prontos para a leitura.
function fakeDb(resultados=[]) {
  const executados=[];
  return {
    executados,
    prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;}};},
    async batch(stmts){executados.push(...stmts);return stmts.map((_,i)=>({results:resultados[i]||[]}));},
  };
}
const req=(method,token,body,query='')=>new Request(`https://canaltabarato.com.br/api/monitor${query}`,{
  method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{}),
});

test('recusa sem o token do bot',async()=>{
  const env={DB:fakeDb(),PUBLISH_TOKEN:'certo'};
  assert.equal((await onRequestGet({request:req('GET','errado'),env})).status,401);
  assert.equal((await onRequestPost({request:req('POST','errado',{}),env})).status,401);
});

test('entrega produtos, histórico diário, último post e fila',async()=>{
  const db=fakeDb([
    [{id:1,loja:'mercadolivre',id_produto:'MLB1'}],
    [{produto_id:1,dia:'2026-11-18',preco:100},{produto_id:1,dia:'2026-11-19',preco:95}],
    [{produto_id:1,lido_em:1000}],
    [{produto_id:1,preco:90,postado_em:2000}],
    [{total:3}],
    [{produto_id:1,preco:90,entrou_em:3000}],
  ]);
  const resposta=await onRequestGet({request:req('GET','certo',null,'?dias=90&posts_desde=1'),env:{DB:db,PUBLISH_TOKEN:'certo'}});
  const corpo=await resposta.json();
  assert.deepEqual(corpo.historico['1'],[['2026-11-18',100],['2026-11-19',95]]);
  assert.equal(corpo.primeira_leitura['1'],1000);
  assert.deepEqual(corpo.ultimo_post['1'],{preco:90,postado_em:2000});
  assert.equal(corpo.posts_hoje,3);
  assert.equal(corpo.fila.length,1);
});

test('grava leituras, post e fila; links só das lojas',async()=>{
  const db=fakeDb();
  const resposta=await onRequestPost({request:req('POST','certo',{
    leituras:[{produto_id:1,preco:99.9,preco_antigo:150,disponivel:true}],
    produtos:[{id:1,nome:'Fone',link_afiliado:'https://evil.example/x',imagem:'https://http2.mlstatic.com/a.jpg'}],
    post:{produto_id:1,preco:99.9,motivo:'menor_preco'},
  }),env:{DB:db,PUBLISH_TOKEN:'certo'}});
  assert.equal(resposta.status,201);
  const insert=db.executados.find(s=>s.sql.startsWith('INSERT INTO monitor_leituras'));
  assert.deepEqual(insert.args.slice(0,4),[1,99.9,150,1]);
  const update=db.executados.find(s=>s.sql.startsWith('UPDATE monitor_produtos'));
  assert.equal(update.args[2],null);
  assert.equal(update.args[3],'https://http2.mlstatic.com/a.jpg');
  assert.ok(db.executados.some(s=>s.sql.startsWith('INSERT INTO monitor_posts')));
  assert.ok(db.executados.some(s=>s.sql.startsWith('DELETE FROM monitor_fila')));
});

test('recusa leitura sem produto',async()=>{
  const resposta=await onRequestPost({request:req('POST','certo',{leituras:[{preco:1}]}),env:{DB:fakeDb(),PUBLISH_TOKEN:'certo'}});
  assert.equal(resposta.status,400);
});
