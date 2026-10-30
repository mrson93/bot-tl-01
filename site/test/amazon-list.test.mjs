import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequestGet,onRequestPost} from '../functions/api/amazon-list.js';

// D1 mínimo em memória: entende só as consultas deste endpoint.
function fakeDb() {
  const rows=[];
  const prepare=sql=>({
    sql,args:[],
    bind(...args){this.args=args;return this;},
    async run(){
      if(sql.startsWith('DELETE')){
        for(let i=rows.length-1;i>=0;i--) if(rows[i].list_id===this.args[0]) rows.splice(i,1);
      } else if(sql.startsWith('INSERT')){
        const [list_id,idx,html,captured_at]=this.args;
        rows.push({list_id,idx,html,captured_at});
      }
      return {};
    },
    async all(){
      return {results:rows.filter(r=>r.list_id===this.args[0]).sort((a,b)=>a.idx-b.idx)};
    },
  });
  return {rows,prepare,async batch(statements){for(const s of statements) await s.run();}};
}

const env=()=>({DB:fakeDb(),AMAZON_LIST_TOKEN:'token-da-extensao',PUBLISH_TOKEN:'token-do-bot'});
const post=(token,body)=>new Request('https://canaltabarato.com.br/api/amazon-list',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify(body),
});
const get=(token,id='2ZUSMM2BR8LVZ')=>new Request(
  `https://canaltabarato.com.br/api/amazon-list?list_id=${id}`,{headers:{Authorization:`Bearer ${token}`}});
const pagina='<a class="single-product-item-link" href="/dp/B000000001">x</a>';

test('extensão grava a lista e o bot lê as páginas na ordem',async()=>{
  const ambiente=env();
  const gravado=await onRequestPost({request:post('token-da-extensao',{list_id:'2ZUSMM2BR8LVZ',pages:[pagina,'p2']}),env:ambiente});
  assert.equal(gravado.status,201);
  const lido=await onRequestGet({request:get('token-do-bot'),env:ambiente});
  assert.equal(lido.status,200);
  const corpo=await lido.json();
  assert.deepEqual(corpo.pages,[pagina,'p2']);
  assert.ok(corpo.captured_at>0);
});

test('novo envio substitui o anterior por completo',async()=>{
  const ambiente=env();
  await onRequestPost({request:post('token-da-extensao',{list_id:'2ZUSMM2BR8LVZ',pages:[pagina,'velha']}),env:ambiente});
  await onRequestPost({request:post('token-da-extensao',{list_id:'2ZUSMM2BR8LVZ',pages:[pagina]}),env:ambiente});
  assert.equal(ambiente.DB.rows.length,1);
});

test('cada token só faz a sua parte',async()=>{
  const ambiente=env();
  const comTokenDoBot=await onRequestPost({request:post('token-do-bot',{list_id:'2ZUSMM2BR8LVZ',pages:[pagina]}),env:ambiente});
  assert.equal(comTokenDoBot.status,401);
  const comTokenDaExtensao=await onRequestGet({request:get('token-da-extensao'),env:ambiente});
  assert.equal(comTokenDaExtensao.status,401);
});

test('página sem produtos (erro ou captcha) não apaga a cópia boa',async()=>{
  const ambiente=env();
  await onRequestPost({request:post('token-da-extensao',{list_id:'2ZUSMM2BR8LVZ',pages:[pagina]}),env:ambiente});
  const ruim=await onRequestPost({request:post('token-da-extensao',{list_id:'2ZUSMM2BR8LVZ',pages:['<html>captcha</html>']}),env:ambiente});
  assert.equal(ruim.status,422);
  assert.equal(ambiente.DB.rows[0].html,pagina);
});

test('rejeita lista inválida e lista sem cópia',async()=>{
  const ambiente=env();
  const invalida=await onRequestPost({request:post('token-da-extensao',{list_id:'../x',pages:[pagina]}),env:ambiente});
  assert.equal(invalida.status,400);
  const vazia=await onRequestGet({request:get('token-do-bot'),env:ambiente});
  assert.equal(vazia.status,404);
});
