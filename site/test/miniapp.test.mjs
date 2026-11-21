import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac} from 'node:crypto';
import {assinarInitData,validarInitData} from '../functions/_webapp_auth.js';
import {ajustar,onAlertas,onGrafico} from '../functions/_webapp_api.js';
import {CSP,onRequestGet as pagina} from '../functions/app/alertas.js';

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
const TOKEN='123456:ABC-teste';
const AGORA=Math.floor(Date.UTC(2026,10,20,15)/1000);
const CAMPOS={query_id:'AAH',user:JSON.stringify({id:55,first_name:'Ana',is_bot:false}),auth_date:String(AGORA-60)};

// Assinatura calculada à mão, exatamente como a documentação do Telegram descreve.
function assinaturaOficial(campos,token) {
  const texto=Object.entries(campos).sort(([a],[b])=>(a<b?-1:1)).map(([k,v])=>`${k}=${v}`).join('\n');
  const chave=createHmac('sha256','WebAppData').update(token).digest();
  return createHmac('sha256',chave).update(texto).digest('hex');
}

test('initData: aceita a assinatura do Telegram e recusa alterada, vencida, de outro bot ou de bot',async()=>{
  const init=await assinarInitData(CAMPOS,TOKEN);
  assert.equal(new URLSearchParams(init).get('hash'),assinaturaOficial(CAMPOS,TOKEN));
  assert.deepEqual(await validarInitData(init,TOKEN,AGORA),{chatId:'55',nome:'Ana'});
  assert.equal(await validarInitData(init.replace('55','66'),TOKEN,AGORA),null);           // alterado
  assert.equal(await validarInitData(init,'999:outro',AGORA),null);                        // outro bot
  assert.equal(await validarInitData(init,TOKEN,AGORA+25*3600),null);                      // vencido
  assert.equal(await validarInitData('',TOKEN,AGORA),null);
  const robo=await assinarInitData({...CAMPOS,user:JSON.stringify({id:7,is_bot:true})},TOKEN);
  assert.equal(await validarInitData(robo,TOKEN,AGORA),null);
});

const ALERTA={id:7,chat_id:'55',produto_id:3,loja:'mercadolivre',id_produto:'MLB1',nome:'Air Fryer',avisar_menor:1,preco_alvo:null,
  queda_percent:null,avisar_estoque:0,ativo:1,expira_em:AGORA+86400*200,link_afiliado:'https://www.mercadolivre.com.br/p/MLB1',
  comparado_em:AGORA,comparacao:null};
const regras=()=>({'SELECT a.*,p.loja':ALERTA,'MIN(preco) AS minimo':{minimo:300,maximo:400,desde:AGORA-86400*40,atual:320,disponivel:1},
  'FROM alerta_precos a JOIN monitor_produtos p ON p.id=a.produto_id\n     WHERE a.chat_id=?':[{...ALERTA,atual:320}]});

test('API: sem initData válido não entra; lista e detalhe só da própria pessoa',async()=>{
  const env={DB:fakeDb(regras()),TELEGRAM_ALERTS_BOT_TOKEN:TOKEN};
  const init=await assinarInitData(CAMPOS,TOKEN);
  const req=(url,opcoes={})=>new Request(`https://canaltabarato.com.br${url}`,{...opcoes,headers:{'X-Telegram-Init-Data':opcoes.init??init,'Content-Type':'application/json'}});
  assert.equal((await onAlertas(req('/api/app/alertas',{init:'hash=00'}),env,AGORA)).status,401);
  const lista=await (await onAlertas(req('/api/app/alertas'),env,AGORA)).json();
  assert.equal(lista.resumo,true);
  assert.equal(lista.alertas[0].nome,'Air Fryer');
  assert.ok(env.DB.executados.some(([sql,args])=>sql.includes('WHERE a.chat_id=?')&&args[0]==='55'));
  const det=await (await onAlertas(req('/api/app/alertas?id=7'),env,AGORA)).json();
  assert.equal(det.alerta.atual,320);
  assert.equal(det.alerta.podeEstoque,true);
  assert.equal(det.alerta.link,'https://www.mercadolivre.com.br/p/MLB1');
  const leitura=env.DB.executados.find(([sql])=>sql.includes('SELECT a.*,p.loja'));
  assert.deepEqual(leitura[1],[7,'55']);
});

test('ajustes usam os caminhos dos botões e respeitam o estado pedido',async()=>{
  const db=fakeDb(regras());
  const env={DB:db};
  // Já ligado: pedir ligado não inverte.
  await ajustar(env,'55',{id:7,acao:'menor',ligado:true},AGORA);
  assert.ok(!db.executados.some(([sql])=>sql.startsWith('UPDATE alerta_precos SET avisar_menor')));
  await ajustar(env,'55',{id:7,acao:'menor',ligado:false},AGORA);
  assert.deepEqual(db.executados.find(([sql])=>sql.startsWith('UPDATE alerta_precos SET avisar_menor'))[1],[0,7,'55']);
  await ajustar(env,'55',{id:7,acao:'queda',valor:20},AGORA);
  assert.ok(db.executados.some(([sql,args])=>sql.includes('queda_percent=?,preco_base=?')&&args[0]===20));
  assert.equal((await ajustar(env,'55',{id:7,acao:'queda',valor:15},AGORA)).erro,'queda_invalida');
  await ajustar(env,'55',{id:7,acao:'valor',valor:'199,90'},AGORA);
  assert.ok(db.executados.some(([sql,args])=>sql.startsWith('UPDATE alerta_precos SET preco_alvo=?')&&args[0]===199.9));
  assert.equal((await ajustar(env,'55',{id:7,acao:'valor',valor:'abc'},AGORA)).erro,'valor_invalido');
  assert.equal((await ajustar(env,'55',{id:7,acao:'prazo',valor:45},AGORA)).erro,'prazo_invalido');
  assert.equal((await ajustar(env,'55',{id:7,acao:'apagar'},AGORA)).apagado,true);
  assert.ok(db.executados.some(([sql,args])=>sql==='DELETE FROM alerta_precos WHERE id=? AND chat_id=?'&&args[1]==='55'));
  await ajustar(env,'55',{acao:'resumo',ligado:false},AGORA);
  assert.ok(db.executados.some(([sql,args])=>sql.startsWith('INSERT INTO alerta_pessoas(chat_id,resumo_semanal)')&&args[1]===0));
  // Alerta de outra pessoa não é encontrado.
  const outro=fakeDb({});
  assert.equal((await ajustar({DB:outro},'55',{id:7,acao:'menor',ligado:true},AGORA)).erro,'alerta_nao_existe');
});

test('gráfico vem como PNG para a dona do alerta',async()=>{
  const dias=Array.from({length:10},(_,i)=>({dia:`2026-11-${String(i+1).padStart(2,'0')}`,preco:300+i}));
  const env={DB:fakeDb({...regras(),'GROUP BY dia':dias}),TELEGRAM_ALERTS_BOT_TOKEN:TOKEN};
  const init=await assinarInitData(CAMPOS,TOKEN);
  const r=await onGrafico(new Request('https://x/api/app/grafico?id=7&dias=30',{headers:{'X-Telegram-Init-Data':init}}),env,AGORA);
  assert.equal(r.headers.get('Content-Type'),'image/png');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer()).subarray(1,4)],[80,78,71]);
  const sem=await onGrafico(new Request('https://x/api/app/grafico?id=7'),env,AGORA);
  assert.equal(sem.status,401);
});

test('página do mini app só pode ser aberta pelo Telegram Web e não indexa',async()=>{
  const r=pagina();
  assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors https:\/\/web\.telegram\.org/);
  assert.match(CSP,/script-src 'self' https:\/\/telegram\.org/);
  assert.equal(r.headers.get('X-Robots-Tag'),'noindex');
  const html=await r.text();
  assert.match(html,/telegram-web-app\.js/);
  assert.match(html,/\/miniapp\/alertas\.js/);
});
