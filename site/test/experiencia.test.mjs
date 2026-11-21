import assert from 'node:assert/strict';
import test from 'node:test';
import {cartao,rotuloDaLista} from '../functions/_price_alerts.js';
import {handleAlertCallback,handleUpdate} from '../functions/_telegram_alerts.js';

function fakeDb(regras={}) {
  const executados=[];
  const responder=(sql,args,tipo)=>{
    for(const [trecho,resposta] of Object.entries(regras)){
      if(sql.includes(trecho)) return typeof resposta==='function'?resposta(args,tipo):resposta;
    }
    return tipo==='all'?[]:null;
  };
  return {
    executados,
    prepare(sql){
      return {
        sql,args:[],
        bind(...args){this.args=args;return this;},
        async first(){executados.push([sql,this.args]);return responder(sql,this.args,'first');},
        async all(){executados.push([sql,this.args]);return {results:responder(sql,this.args,'all')||[]};},
        async run(){executados.push([sql,this.args]);return {meta:{changes:1}};},
      };
    },
    async batch(stmts){for(const s of stmts) executados.push([s.sql,s.args]);return [];},
  };
}
const AGORA=1_800_000_000;
const BASE={id:7,chat_id:'55',produto_id:3,loja:'mercadolivre',id_produto:'MLB1',nome:'Air Fryer',avisar_menor:1,ativo:1,
  expira_em:AGORA+9e6,link_afiliado:'https://www.mercadolivre.com.br/p/MLB1',comparado_em:AGORA,criado_em:AGORA-86400};
const DIAS=Array.from({length:20},(_,i)=>({dia:`2026-01-${String(i+1).padStart(2,'0')}`,preco:i<15?400:300}));

test('cartão em ordem de decisão e botões principais primeiro',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':BASE,'MIN(preco) AS minimo':{minimo:300,maximo:400,desde:AGORA-86400*20,atual:300,disponivel:1},'GROUP BY dia':DIAS});
  const c=await cartao({DB:db},'55',7,AGORA);
  const linhas=c.text.split('\n');
  const pos=t=>linhas.findIndex(l=>l.includes(t));
  assert.ok(pos('💰 Agora')<pos('🟢 Preço baixo')&&pos('🟢 Preço baixo')<pos('📊 Em'));
  assert.deepEqual(c.markup.inline_keyboard[0].map(b=>b.text),['🛒 Ver na loja','📈 Gráfico']);
  assert.deepEqual(c.markup.inline_keyboard.at(-1).map(b=>b.text),['🗑 Apagar alerta','📋 Todos']);
  assert.ok(c.markup.inline_keyboard.flat().some(b=>b.text==='⏳ Prazo'));
  // Preço que não mudou: sem o mini gráfico de linha reta.
  const reto=fakeDb({'SELECT a.*,p.loja':BASE,'MIN(preco) AS minimo':{minimo:300,maximo:300,desde:AGORA-86400*20,atual:300,disponivel:1},
    'GROUP BY dia':DIAS.map(d=>({...d,preco:300}))});
  assert.doesNotMatch((await cartao({DB:reto},'55',7,AGORA)).text,/📈 30 dias/);
});

test('produto sem leitura há mais de 6 h ganha explicação em vez de "aguardando"',async()=>{
  const novo=fakeDb({'SELECT a.*,p.loja':{...BASE,criado_em:AGORA-3600}});
  assert.match((await cartao({DB:novo},'55',7,AGORA)).text,/aguardando a primeira leitura/);
  const velho=fakeDb({'SELECT a.*,p.loja':BASE});
  const t=(await cartao({DB:velho},'55',7,AGORA)).text;
  assert.match(t,/Ainda não consegui ler o preço/);
  assert.match(t,/\/p\/MLB…/);
});

test('Shopee sem link: o site gera o link de afiliado e guarda',async()=>{
  const shopee={...BASE,loja:'shopee',id_produto:'1_2',link_afiliado:null};
  const db=fakeDb({'SELECT a.*,p.loja':shopee});
  const pedidos=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{pedidos.push(JSON.parse(init.body).query);return Response.json({data:{generateShortLink:{shortLink:'https://s.shopee.com.br/abc'}}});};
  let c;
  try{ c=await cartao({DB:db,SHOPEE_APP_ID:'1',SHOPEE_SECRET:'s'},'55',7,AGORA); }finally{globalThis.fetch=original;}
  assert.match(pedidos[0],/generateShortLink\(input:\{originUrl:"https:\/\/shopee\.com\.br\/product\/1\/2",subIds:\["alerta"\]\}\)/);
  assert.equal(c.markup.inline_keyboard[0][0].url,'https://s.shopee.com.br/abc');
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE monitor_produtos SET link_afiliado'))[1],['https://s.shopee.com.br/abc',3]);
  // Sem as chaves: sem botão de loja, sem erro.
  const sem=await cartao({DB:fakeDb({'SELECT a.*,p.loja':shopee})},'55',7,AGORA);
  assert.deepEqual(sem.markup.inline_keyboard[0].map(b=>b.text),['📈 Gráfico','⏳ Prazo']);
});

test('/start curto com atalhos e "Como funciona" com o passo a passo',async()=>{
  const env={DB:fakeDb()};
  const [boas,atalhos]=await handleUpdate(env,{message:{chat:{id:55,type:'private'},text:'/start'}},AGORA);
  assert.ok(boas.text.split('\n').length<=5);
  assert.ok(boas.markup.keyboard);
  assert.deepEqual(atalhos.markup.inline_keyboard.flat().map(b=>b.callback_data),['ex','bn','aj']);
  const ajuda=await handleAlertCallback(env,'55','aj',AGORA);
  assert.match(ajuda.text,/Como usar, em 3 passos/);
  assert.match(ajuda.text,/volta ao estoque \(Mercado Livre\)/);
});

test('botão da lista traz termômetro, nome e preço',()=>{
  assert.match(rotuloDaLista({nome:'Air Fryer',atual:299.9,termometro:{nivel:'baixo',emoji:'🟢'}}),/^🟢 Air Fryer · R\$\s?299,90$/);
  assert.match(rotuloDaLista({nome:'Fone',atual:99,termometro:{nivel:'aprendendo',emoji:'⏳'}}),/^🔔 Fone · R\$/);
  assert.match(rotuloDaLista({nome:null,loja:'shopee',atual:null}),/^⏳ Produto da Shopee/);
});
