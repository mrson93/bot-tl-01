import assert from 'node:assert/strict';
import test from 'node:test';
import {ehGrupo,handleGroupMessage,handleMembership,paraGrupo,precisaDeAdmin,proibidoNoGrupo} from '../functions/_groups.js';
import {responderBotao} from '../functions/api/telegram-alerts.js';
import {limitePessoa} from '../functions/_referral.js';
import {enviarResumos} from '../functions/_weekly_summary.js';

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
const GRUPO='-1001234567890';
const msg=(text,extra={})=>({message_id:5,chat:{id:Number(GRUPO),type:'supergroup',title:'Família'},from:{id:42,is_bot:false},text,...extra});
// Telegram de mentira: getChatMember diz se a pessoa é admin.
const telegramFalso=(admins=[])=>{
  const chamadas=[];
  const fetcher=async(url,init)=>{
    const metodo=String(url).split('/').pop(), corpo=init?.body?JSON.parse(init.body):{};
    chamadas.push({metodo,corpo});
    if(metodo==='getChatMember') return Response.json({ok:true,result:{status:admins.includes(corpo.user_id)?'administrator':'member'}});
    return new Response('{}',{status:200});
  };
  return {chamadas,fetcher};
};

test('reconhece grupos e regras dos botões',()=>{
  assert.ok(ehGrupo(GRUPO));
  assert.ok(!ehGrupo('55'));
  for(const livre of ['l','a:7:c','a:7:g','a:7:gt:365','b:sp:1_2','bn','-']) assert.equal(precisaDeAdmin(livre),false,livre);
  for(const admin of ['a:7:m','a:7:v','a:7:q:20','a:7:p:90','a:7:x','a:7:xx','a:7:s','a:7:f','a:7:r']) assert.equal(precisaDeAdmin(admin),true,admin);
  for(const fora of ['cv','rs:0','k:air fryer']) assert.ok(proibidoNoGrupo(fora));
  const limpo=paraGrupo({text:'x',markup:{inline_keyboard:[[{text:'📱',web_app:{url:'https://x'}}],[{text:'k',callback_data:'k:fone'}],[{text:'1',callback_data:'b:sp:1_2'}],[{text:'🎁',callback_data:'cv'}]]}});
  assert.deepEqual(limpo.markup.inline_keyboard,[[{text:'1',callback_data:'b:sp:1_2'}]]);
  assert.equal(paraGrupo({text:'x',markup:{keyboard:[[{text:'a'}]]}}).markup,null);
});

test('qualquer membro adiciona pelo link; comandos de outro bot são ignorados',async()=>{
  const db=fakeDb({'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:0},'COUNT(DISTINCT produto_id)':{total:0},
    'INSERT INTO monitor_produtos':{id:3,nome:'Fone'},'INSERT INTO alerta_precos':{id:70},
    'SELECT a.*,p.loja':{id:70,chat_id:GRUPO,produto_id:3,loja:'mercadolivre',id_produto:'MLB123',nome:'Fone',avisar_menor:1,ativo:1,expira_em:AGORA+9e6,comparado_em:AGORA}});
  const env={DB:db};
  const r=await handleGroupMessage(env,msg('/alerta@TaBaratoAlertaDePrecoBot https://www.mercadolivre.com.br/fone/p/MLB123'),AGORA);
  assert.match(r.text,/Alerta criado/);
  assert.equal(db.executados.find(([sql])=>sql.includes('INSERT INTO alerta_precos'))[1][0],GRUPO);
  assert.ok(!r.markup.inline_keyboard.flat().some(b=>b.web_app||b.callback_data==='cv'));
  assert.equal(await handleGroupMessage(env,msg('/alerta@OutroBot https://x'),AGORA),null);
  assert.equal(await handleGroupMessage(env,msg('oi pessoal'),AGORA),null);           // conversa comum: nada
  assert.match((await handleGroupMessage(env,msg('/alerta'),AGORA)).text,/Mande junto o link/);
  assert.match((await handleGroupMessage(env,msg('/ajuda'),AGORA)).text,/Lista de desejos do grupo/);
});

test('grupo tem limite de 20, sem convite, e fica fora do resumo semanal',async()=>{
  assert.equal(await limitePessoa({DB:fakeDb()},GRUPO),20);
  const cheio=fakeDb({'COUNT(*) AS total FROM alerta_precos WHERE chat_id':{total:20}});
  const r=await handleGroupMessage({DB:cheio},msg('/alerta https://www.mercadolivre.com.br/fone/p/MLB123'),AGORA);
  assert.match(r.text,/Você já tem 20 produtos/);
  assert.equal(r.markup,null);
  const resumo=fakeDb();
  await enviarResumos({DB:resumo,TELEGRAM_ALERTS_BOT_TOKEN:'t'},Math.floor(Date.UTC(2026,10,23,13,7)/1000),async()=>new Response('{}'));
  assert.match(resumo.executados.find(([sql])=>sql.includes('SELECT DISTINCT a.chat_id'))[0],/a\.chat_id NOT LIKE '-%'/);
});

test('/parar e valor por resposta só para admins',async()=>{
  const db=fakeDb({"editando_em>=":{id:70,nome:'Fone',chat_id:GRUPO},'SELECT a.*,p.loja':{id:70,chat_id:GRUPO,produto_id:3,loja:'shopee',nome:'Fone',avisar_menor:1,ativo:1,expira_em:AGORA+9e6,comparado_em:AGORA}});
  const membro=telegramFalso([]);
  assert.match((await handleGroupMessage({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},msg('/parar'),AGORA,membro.fetcher)).text,/Só admins/);
  assert.ok(!db.executados.some(([sql])=>sql.startsWith('DELETE')));
  const admin=telegramFalso([42]);
  assert.match((await handleGroupMessage({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},msg('/parar'),AGORA,admin.fetcher)).text,/lista do grupo foi apagada/);
  assert.ok(db.executados.some(([sql,args])=>sql==='DELETE FROM alerta_precos WHERE chat_id=?'&&args[0]===GRUPO));
  assert.deepEqual(admin.chamadas[0].corpo,{chat_id:GRUPO,user_id:42});
  // Resposta à pergunta do valor: membro comum é ignorado.
  const resposta=msg('199,90',{reply_to_message:{from:{is_bot:true,username:'TaBaratoAlertaDePrecoBot'},text:'Quanto você quer pagar por Fone?'}});
  assert.equal(await handleGroupMessage({DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'},resposta,AGORA,membro.fetcher),null);
});

test('botões no grupo: ver é livre, mudar pede admin, convite não existe',async()=>{
  const db=fakeDb({'SELECT a.*,p.loja':{id:7,chat_id:GRUPO,produto_id:3,loja:'mercadolivre',nome:'Fone',avisar_menor:1,ativo:1,expira_em:AGORA+9e6,comparado_em:AGORA}});
  const env={DB:db,TELEGRAM_ALERTS_BOT_TOKEN:'t'};
  const consulta=(data,from=42)=>({id:'q',data,from:{id:from},message:{message_id:9,text:'cartão',chat:{id:Number(GRUPO),type:'supergroup'}}});
  const membro=telegramFalso([]);
  await responderBotao(env,consulta('a:7:m'),membro.fetcher,AGORA);
  assert.match(membro.chamadas.at(-1).corpo.text,/Só admins/);
  assert.ok(!db.executados.some(([sql])=>sql.startsWith('UPDATE alerta_precos')));
  await responderBotao(env,consulta('cv'),membro.fetcher,AGORA);
  assert.match(membro.chamadas.at(-1).corpo.text,/só existe no privado/);
  await responderBotao(env,consulta('a:7:c'),membro.fetcher,AGORA);
  assert.match(membro.chamadas.findLast(c=>c.metodo==='sendMessage').corpo.text,/Fone/);  // ver o cartão é livre
  const admin=telegramFalso([42]);
  await responderBotao(env,consulta('a:7:m'),admin.fetcher,AGORA);
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET avisar_menor'))[1],[0,7,GRUPO]);
  await responderBotao(env,consulta('a:7:v'),admin.fetcher,AGORA);
  const pedido=admin.chamadas.findLast(c=>c.metodo==='sendMessage');
  assert.equal(pedido.corpo.reply_markup.force_reply,true);
  assert.match(pedido.corpo.text,/Responda a esta mensagem com o valor/);
});

test('entrada do bot dá boas-vindas; saída apaga a lista; supergrupo leva a lista junto',async()=>{
  const db=fakeDb();
  const chat={id:Number(GRUPO),type:'supergroup',title:'Família'};
  const oi=await handleMembership({DB:db},{chat,old_chat_member:{status:'left'},new_chat_member:{status:'member'}});
  assert.match(oi.text,/Lista de desejos do grupo/);
  assert.equal(await handleMembership({DB:db},{chat,old_chat_member:{status:'member'},new_chat_member:{status:'kicked'}}),null);
  assert.ok(db.executados.some(([sql,args])=>sql==='DELETE FROM alerta_precos WHERE chat_id=?'&&args[0]===GRUPO));
  assert.equal(await handleMembership({DB:db},{chat:{id:55,type:'private'},new_chat_member:{status:'kicked'}}),null);
  await handleGroupMessage({DB:db},{chat:{id:-555,type:'group'},migrate_to_chat_id:-1009999},AGORA);
  assert.deepEqual(db.executados.at(-1)[1],['-1009999','-555']);
});
