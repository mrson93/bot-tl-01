import assert from 'node:assert/strict';
import test from 'node:test';
import {handleCallback,listaComBotoes} from '../functions/_price_alerts.js';
import {enviarResumos,janelaDoResumo,montarResumo} from '../functions/_weekly_summary.js';
import {paginaQuedasDeHoje,quedasDeHoje} from '../functions/_price_drops.js';
import {onRequestGet as apiQuedas} from '../functions/api/quedas-de-hoje.js';
import {handleUpdate} from '../functions/_telegram_alerts.js';

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
const brasilia=(dia,hora)=>Math.floor(Date.UTC(2026,10,dia,hora+3,7)/1000); // novembro/2026
const SEGUNDA_10H=brasilia(23,10);  // 23/11/2026 é segunda

test('janela do resumo: segunda a partir das 10h e terça inteira',()=>{
  const inicio=brasilia(23,0)-7*60;
  assert.equal(janelaDoResumo(SEGUNDA_10H),inicio);
  assert.equal(janelaDoResumo(brasilia(24,22)),inicio);
  assert.equal(janelaDoResumo(brasilia(23,9)),null);
  assert.equal(janelaDoResumo(brasilia(25,12)),null);
  assert.equal(janelaDoResumo(brasilia(22,12)),null);
});

test('texto do resumo conta quedas e altas e ignora produto sem leitura',()=>{
  const texto=montarResumo([
    {nome:'Air Fryer',loja:'mercadolivre',atual:300,antes:350,lido_em:1,menor_semana:290,termometro:{nivel:'baixo',emoji:'🟢'}},
    {nome:'Fone <JBL>',loja:'shopee',atual:220,antes:200,lido_em:1,menor_semana:220,termometro:{nivel:'caro',emoji:'🔴'}},
    {nome:'Mochila',loja:'shopee',atual:100,antes:100,lido_em:1},
    {nome:'Novo',loja:'shopee',atual:50,antes:null,lido_em:1,termometro:{nivel:'aprendendo',emoji:'⏳'}},
    {nome:'Sem leitura',loja:'shopee',atual:90,lido_em:null},
  ]);
  assert.match(texto,/1 caiu · 1 subiu · 2 sem mudança/);
  assert.match(texto,/📉 <b>Air Fryer<\/b>\n    R\$\s?300,00 \(era R\$\s?350,00, −14%\) · menor da semana R\$\s?290,00 · 🟢/);
  assert.match(texto,/📈 <b>Fone &lt;JBL&gt;<\/b>\n    R\$\s?220,00 \(era R\$\s?200,00, \+10%\) · 🔴/);
  assert.match(texto,/Novo<\/b>\n    R\$\s?50,00 \(começou esta semana\)$/m);
  assert.doesNotMatch(texto,/Sem leitura/);
  assert.equal(montarResumo([{nome:'x',atual:10,lido_em:null}]),null);
});

test('envia o resumo em lote, marca quem recebeu e apaga quem bloqueou',async()=>{
  const alertas={'55':[{id:1,produto_id:3,nome:'Air Fryer',loja:'mercadolivre',atual:300}],
    '66':[{id:2,produto_id:4,nome:'Fone',loja:'shopee',atual:200}],'77':[]};
  const db=fakeDb({
    'SELECT DISTINCT a.chat_id':[{chat_id:'55'},{chat_id:'66'},{chat_id:'77'}],
    'FROM alerta_precos a JOIN monitor_produtos':args=>alertas[args[0]]||[],
    'MAX(lido_em) FROM monitor_leituras':args=>(alertas[args[0]]||[]).map(a=>({id:a.id,lido_em:1,antes:350,menor_semana:300})),
  });
  const chamadas=[];
  const fetcher=async(url,init)=>{const corpo=JSON.parse(init.body);chamadas.push(corpo);return new Response('{}',{status:corpo.chat_id==='66'?403:200});};
  const env={DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'};
  assert.equal(await enviarResumos(env,SEGUNDA_10H,fetcher),1);
  assert.deepEqual(chamadas.map(c=>c.chat_id),['55','66']);  // 77 sem produto com leitura: nada
  assert.match(chamadas[0].text,/Seu resumo da semana/);
  assert.equal(chamadas[0].reply_markup.inline_keyboard[0][1].callback_data,'rs:0');
  const pessoas=db.executados.find(([sql])=>sql.includes('SELECT DISTINCT a.chat_id'));
  assert.deepEqual(pessoas[1],[SEGUNDA_10H,brasilia(23,0)-7*60,50]);
  assert.match(pessoas[0],/COALESCE\(p\.resumo_semanal,1\)=1/);
  assert.equal(db.executados.filter(([sql])=>sql.startsWith('INSERT INTO alerta_pessoas(chat_id,resumo_enviado_em)')).length,3);
  assert.ok(db.executados.some(([sql,args])=>sql==='DELETE FROM alerta_pessoas WHERE chat_id=?'&&args[0]==='66'));
  // Fora da janela ou sem token: nada.
  assert.equal(await enviarResumos(env,brasilia(25,12),fetcher),0);
  assert.equal(await enviarResumos({DB:db},SEGUNDA_10H,fetcher),0);
  assert.equal(chamadas.length,2);
});

test('liga e desliga o resumo pelo botão e mostra em Meus alertas',async()=>{
  const db=fakeDb({'SELECT resumo_semanal':{resumo_semanal:0},'FROM alerta_precos a JOIN':[{id:7,produto_id:3,nome:'Air Fryer',atual:300}]});
  const desligar=await handleCallback({DB:db},'55','rs:0');
  assert.equal(desligar.answer,'Resumo semanal desligado');
  assert.deepEqual(db.executados.at(-1)[1],['55',0]);
  assert.equal(desligar.markup.inline_keyboard[0][0].callback_data,'rs:1');
  assert.deepEqual(listaComBotoes([{id:7,nome:'X'}],true).inline_keyboard[1][0],{text:'⚙️ Resumo semanal: ligado',callback_data:'rs:0'});
  assert.equal(listaComBotoes([{id:7,nome:'X'}]).inline_keyboard.length,1);
  const lista=await handleCallback({DB:db},'55','l');
  assert.equal(lista.markup.inline_keyboard.at(-1)[0].text,'⚙️ Resumo semanal: desligado');
  const meus=await handleUpdate({DB:db},{message:{chat:{id:55,type:'private'},text:'📋 Meus alertas'}});
  assert.equal(meus.markup.inline_keyboard.at(-1)[0].callback_data,'rs:1');
});

const QUEDAS=[
  {id:3,loja:'mercadolivre',id_produto:'MLB111',nome:'Air Fryer',imagem:'https://http2.mlstatic.com/a.jpg',
    link_afiliado:'https://www.mercadolivre.com.br/p/MLB111?matt_tool=1',agora:300,antes:400},
  {id:4,loja:'shopee',id_produto:'1_2',nome:'Fone <b>',imagem:'https://golpe.example/x.jpg',link_afiliado:'https://s.shopee.com.br/abc',agora:90,antes:100},
  {id:5,loja:'shopee',id_produto:'1_3',nome:'Link estranho',link_afiliado:'https://golpe.example/x',agora:1,antes:100},
];

test('maiores quedas: porcentagem, termômetro, links seguros e nada de quem monitora',async()=>{
  const db=fakeDb({'FROM monitor_leituras l WHERE l.lido_em>=?1':QUEDAS,
    'GROUP BY produto_id,dia':Array.from({length:20},(_,i)=>({produto_id:3,dia:`2026-10-${10+i}`,preco:400}))});
  const agora=brasilia(20,20);
  const itens=await quedasDeHoje({DB:db},agora,10);
  assert.deepEqual(itens.map(i=>[i.id,i.queda]),[[3,25],[4,10]]);
  assert.equal(itens[0].termometro.nivel,'baixo');
  assert.equal(itens[0].alerta,'https://t.me/TaBaratoAlertaDePrecoBot?start=ml_MLB111');
  assert.equal(itens[1].imagem,null);
  const consulta=db.executados[0];
  assert.deepEqual(consulta[1],[agora-6*3600,agora-30*3600,agora-20*3600,0.05,10]);
  assert.doesNotMatch(consulta[0],/alerta_precos|chat_id/);

  const pagina=await (await paginaQuedasDeHoje({DB:db},agora)).text();
  assert.match(pagina,/Maiores quedas de hoje/);
  assert.match(pagina,/−25%/);
  assert.match(pagina,/Fone &lt;b&gt;/);
  assert.match(pagina,/href="https:\/\/www.mercadolivre.com.br\/p\/MLB111\?matt_tool=1" rel="nofollow sponsored"/);
  assert.doesNotMatch(pagina,/golpe\.example/);
  const vazia=await (await paginaQuedasDeHoje({DB:fakeDb()},agora)).text();
  assert.match(vazia,/Nenhuma queda forte hoje/);

  const api=await (await apiQuedas({request:new Request('https://x/api/quedas-de-hoje?limite=5'),env:{DB:db}})).json();
  assert.equal(api.quedas.length,2);
  assert.deepEqual(Object.keys(api.quedas[0].termometro),['nivel','emoji']);
  assert.equal(db.executados.filter(([sql])=>sql.includes('l.lido_em>=?1')).at(-1)[1][4],5);
});
